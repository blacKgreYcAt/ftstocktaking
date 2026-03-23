
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  FileDown, CheckCircle2, Search,
  ScanBarcode, FileSpreadsheet, X,
  Link, Info, Package, ClipboardCheck, AlertCircle, PlusCircle, MapPin, Clock, User,
  Pause, Play, LogOut, Edit3, Hash, CloudSync, CloudCheck, CloudOff, Menu,
  Camera, CameraOff, RefreshCw, AlertTriangle, Terminal, Bug,
  Sun, Moon
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { InventoryItem, LogEntry } from './types';
import { audioService } from './services/audioService';

const STORAGE_KEY = 'dafeng_inventory_local_v11';
const LOGS_KEY = 'dafeng_inventory_logs_v1';

type TimeFormat = 'off' | 'datetime' | 'date';
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

const App: React.FC = () => {
  const [data, setData] = useState<InventoryItem[]>([]);
  const [lastScanned, setLastScanned] = useState<InventoryItem | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [scanQty, setScanQty] = useState('1');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [showUnscannedList, setShowUnscannedList] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  
  const [newProductName, setNewProductName] = useState('');
  const [newProductCode, setNewProductCode] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [operatorName, setOperatorName] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('T0300');
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentLocation, setCurrentLocation] = useState('');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('date');

  // Refs to avoid stale closures in scanner callbacks
  const dataRef = useRef(data);
  const configRef = useRef({ scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode });

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    configRef.current = { scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode };
  }, [scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode]);
  
  // Camera Scanner State
  const [showScanner, setShowScanner] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerRegionId = "html5qr-code-full-region";

  const inputRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((type: LogEntry['type'], message: string, details?: any) => {
    const newLog: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };
    setLogs(prev => {
      const updated = [newLog, ...prev].slice(0, 1000); // Keep last 1000 logs
      localStorage.setItem(LOGS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedLogs = localStorage.getItem(LOGS_KEY);
    
    if (savedLogs) {
      try { setLogs(JSON.parse(savedLogs)); } catch (e) { console.error(e); }
    }

    // Global Error Handler
    const handleError = (event: ErrorEvent) => {
      addLog('error', `Runtime Error: ${event.message}`, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      addLog('error', `Unhandled Rejection: ${event.reason?.message || String(event.reason)}`, {
        reason: event.reason
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    addLog('system', '系統啟動');

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.items?.length > 0) setData(parsed.items);
        if (parsed.config) {
          setLocationEnabled(!!parsed.config.locationEnabled);
          setCurrentLocation(parsed.config.currentLocation || '');
          setTimeFormat(parsed.config.timeFormat === 'off' ? 'date' : (parsed.config.timeFormat || 'date'));
          setOperatorName(parsed.config.operatorName || '');
          setWarehouseCode(parsed.config.warehouseCode || 'T0300');
          setIsPaused(!!parsed.config.isPaused);
          if (parsed.config.isDarkMode !== undefined) setIsDarkMode(parsed.config.isDarkMode);
        }
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (data.length > 0 || operatorName || warehouseCode !== 'T0300' || locationEnabled || timeFormat !== 'off' || isPaused || !isDarkMode) {
      const config = { locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: data, config }));
    }
  }, [data, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode]);

  // Focus Logic
  const focusInput = useCallback(() => {
    // 如果當前焦點已經在任何輸入框內，就不執行自動抓回焦點
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

    if (inputRef.current && !showUnscannedList && !showMappingModal && !isPaused && !showScanner) {
      inputRef.current.focus();
    }
  }, [showUnscannedList, showMappingModal, isPaused, showScanner]);

  useEffect(() => {
    focusInput();
    const h = () => focusInput();
    window.addEventListener('click', h);
    return () => {
      window.removeEventListener('click', h);
      stopScanner(); // Cleanup scanner on unmount
    };
  }, [focusInput]);

  // Cloud Backup
  const backupToCloud = async (itemsToSync: InventoryItem[]) => {
    if (itemsToSync.length === 0) return;
    setSyncStatus('syncing');
    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator: operatorName,
          items: itemsToSync.filter(i => i.actualQty > 0)
        })
      });
      if (response.ok) {
        setSyncStatus('success');
      } else {
        setSyncStatus('error');
      }
    } catch (e) {
      console.error("Backup failed", e);
      setSyncStatus('error');
    }
  };

  const getFormattedTime = () => {
    if (timeFormat === 'off') return undefined;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    if (timeFormat === 'date') return `${y}/${m}/${d}`;
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}`;
  };

  // --- 核心邏輯重構：處理條碼 (共用於 USB 槍與鏡頭) ---
  const processBarcode = (code: string, qtyOverride?: number) => {
    const { isPaused, scanQty, locationEnabled, currentLocation, timeFormat, operatorName } = configRef.current;
    const currentData = dataRef.current;

    if (isPaused) return;

    let targetCode = code.trim();
    let currentAddQty = qtyOverride !== undefined ? qtyOverride : (parseFloat(scanQty) || 1);

    // 處理 "數量*條碼" 格式
    if (targetCode.includes('*')) {
      const parts = targetCode.split('*');
      if (parts.length === 2) {
        const manualQty = parseFloat(parts[0]);
        if (!isNaN(manualQty)) {
          currentAddQty = manualQty;
          targetCode = parts[1].trim();
        }
      }
    }

    if (!targetCode || currentData.length === 0) return;

    const index = currentData.findIndex(item => 
      item.barcode === targetCode || item.productCode === targetCode || item.mappedBarcodes?.includes(targetCode)
    );

    if (index !== -1) {
      // 成功掃描
      const updatedData = [...currentData];
      const item = { ...updatedData[index] };
      item.actualQty += currentAddQty;
      item.diff = item.actualQty - item.bookQty;
      
      addLog('scan', `成功掃描: ${item.productCode}`, { barcode: targetCode, qty: currentAddQty });

      if (locationEnabled && currentLocation.trim()) item.location = currentLocation.trim();
      const t = getFormattedTime();
      if (t) item.scanTime = t;
      if (operatorName.trim()) item.operator = operatorName.trim();
      
      updatedData[index] = item;
      setData(updatedData);
      setLastScanned(item);
      setIsSuccess(true);
      audioService.speakSuccess('', 0);
      setTimeout(() => setIsSuccess(false), 300);
      
      // 如果是用相機掃的，掃完自動關閉
      if (showScanner) {
          stopScanner();
      }
    } else {
      // 未知條碼
      addLog('error', `未知條碼: ${targetCode}`, { qty: currentAddQty });
      setUnknownBarcode(targetCode);
      setNewProductName('');
      setNewProductCode('');
      setIsCreatingNew(false);
      setShowMappingModal(true);
      audioService.speakError();
      if (showScanner) {
        stopScanner();
      }
    }
  };

  // 表單提交 (USB 槍)
  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    processBarcode(inputValue);
    setInputValue('');
  };

  // --- 相機掃描邏輯 ---
  const startScanner = () => {
    setShowScanner(true);
    setCameraError('');
    
    // 稍微延遲以確保 DOM 已渲染
    setTimeout(() => {
        const html5QrCode = new Html5Qrcode(scannerRegionId);
        scannerRef.current = html5QrCode;
        
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        
        // 優先使用後置鏡頭 environment
        html5QrCode.start(
            { facingMode: "environment" }, 
            config, 
            (decodedText) => {
                // Scan Success
                processBarcode(decodedText);
            },
            (errorMessage) => {
                // parse error, ignore
            }
        ).catch(err => {
            console.error("Camera Error", err);
            let msg = "無法啟動相機。";
            if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
                msg = "安全限制：瀏覽器禁止在 HTTP 網頁使用相機。請參閱說明開啟權限。";
            } else if (err?.name === 'NotAllowedError') {
                msg = "請允許瀏覽器存取相機權限。";
            }
            setCameraError(msg);
        });
    }, 100);
  };

  const stopScanner = () => {
      if (scannerRef.current) {
          scannerRef.current.stop().then(() => {
              scannerRef.current?.clear();
              setShowScanner(false);
          }).catch(err => console.error("Failed to stop scanner", err));
      } else {
          setShowScanner(false);
      }
  };

  const manualSetTotalQty = () => {
    if (!lastScanned) return;
    const newTotal = window.prompt(`[手動調整] 請輸入 "${lastScanned.name}" 的總盤點數量：`, lastScanned.actualQty.toString());
    if (newTotal !== null) {
      const parsed = parseFloat(newTotal);
      if (!isNaN(parsed)) {
        const index = data.findIndex(i => i.productCode === lastScanned.productCode);
        const updatedData = [...data];
        updatedData[index].actualQty = parsed;
        updatedData[index].diff = updatedData[index].actualQty - updatedData[index].bookQty;
        setData(updatedData);
        setLastScanned(updatedData[index]);
        audioService.speakMappingSuccess();
      }
    }
  };

  const handleCreateNewItem = () => {
    if (!newProductName.trim() || !newProductCode.trim()) {
      alert("品名與產品代號均為必填項目");
      return;
    }
    const newItem: InventoryItem = {
      barcode: unknownBarcode,
      productCode: newProductCode.trim(),
      name: newProductName.trim(),
      bookQty: 0,
      actualQty: parseFloat(scanQty) || 1,
      diff: parseFloat(scanQty) || 1,
      location: (locationEnabled && currentLocation.trim()) ? currentLocation.trim() : undefined,
      scanTime: getFormattedTime(),
      operator: operatorName.trim() || undefined,
      originalRow: { '國際條碼': unknownBarcode, '款式代號': newProductCode.trim(), '商品名稱': newProductName.trim(), '合計': 0 }
    };
    setData([newItem, ...data]);
    addLog('info', `建立新項目: ${newProductCode}`, { barcode: unknownBarcode, name: newProductName });
    setLastScanned(newItem);
    setShowMappingModal(false);
    audioService.speakMappingSuccess();
  };

  const handleExport = () => {
    if (data.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(data.map(i => ({
      ...i.originalRow,
      '實際盤點': i.actualQty,
      '差異': i.diff,
      '作業員': i.operator || '',
      '儲位': i.location || '',
      '盤點時間': i.scanTime || '',
      '手動關聯條碼': i.mappedBarcodes?.join(', ')
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "盤點結果");
    XLSX.writeFile(wb, `大豐盤點_${new Date().toLocaleDateString()}.xlsx`);
    addLog('info', '匯出 Excel 報表', { itemCount: data.length });
  };

  const handleExportMachineFormat = () => {
    if (data.length === 0) return;
    
    const now = new Date();
    const yyyymmdd = now.getFullYear().toString() + 
                     (now.getMonth() + 1).toString().padStart(2, '0') + 
                     now.getDate().toString().padStart(2, '0');
    
    const workId = `${yyyymmdd}FT015`;
    const suffix = "0 00000021";
    
    // Helper to pad strings to fixed width
    const pad = (str: string, length: number) => {
      return (str || '').toString().padEnd(length, ' ');
    };

    const lines = data
      .filter(item => item.actualQty > 0)
      .map(item => {
        const col1 = pad(warehouseCode, 15);
        const col2 = pad(workId, 20);
        const col3 = pad(item.location || currentLocation || ' ', 12);
        const col4 = pad(item.barcode || item.productCode, 32);
        const col5 = pad(item.actualQty.toString(), 56);
        const col6 = suffix;
        
        return `${col1}${col2}${col3}${col4}${col5}${col6}`;
      });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `大豐盤點機格式_${yyyymmdd}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addLog('info', '匯出盤點機格式 TXT 報表', { itemCount: lines.length });
  };

  const handleExportLogs = () => {
    const logData = {
      app: "大豐資訊盤點系統",
      exportTime: new Date().toISOString(),
      operator: operatorName,
      deviceInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language
      },
      inventorySummary: {
        totalItems: data.length,
        scannedItems: data.filter(i => i.actualQty > 0).length
      },
      logs: logs
    };

    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dafeng_op_log_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('info', '匯出作業紀錄檔');
  };

  const handleClearLogs = () => {
    if (window.confirm('確定要清除所有紀錄嗎？')) {
      setLogs([]);
      localStorage.removeItem(LOGS_KEY);
      addLog('system', '紀錄已清除');
    }
  };

  const handleClearAllData = () => {
    if (window.confirm('警告：這將清除所有已盤點數據與匯入的庫存檔！確定要繼續嗎？')) {
      if (window.confirm('請再次確認：所有資料將永久刪除。')) {
        setData([]);
        setLastScanned(null);
        localStorage.removeItem(STORAGE_KEY);
        addLog('system', '所有資料已清除');
        window.location.reload();
      }
    }
  };

  const handleEndJob = () => {
    if (data.length === 0) return;
    if (window.confirm("確定要結束盤點工作嗎？系統將自動匯出最終報表。")) {
      handleExport();
      if (window.confirm("報表已匯出。是否要清空本次盤點數據以開始新的工作？")) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.reload();
      }
    }
  };

  const togglePause = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    if (nextPaused && data.length > 0) {
      backupToCloud(data);
    } else {
      setSyncStatus('idle');
    }
    audioService.playFeedback(nextPaused ? 'mapping' : 'success');
  };

  return (
    // Root: 手機版 min-h-screen 並允許捲動，電腦版 h-screen 並鎖定捲動
    <div className={`flex flex-col p-3 md:p-4 lg:p-6 select-none relative min-h-screen md:h-screen overflow-y-auto md:overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* --- 相機掃描視窗 --- */}
      {showScanner && (
          <div className="fixed inset-0 z-[300] bg-black flex flex-col items-center justify-center">
              <div className="relative w-full max-w-md aspect-[3/4] bg-black">
                  <div id={scannerRegionId} className="w-full h-full"></div>
                  {/* 掃描框遮罩視覺效果 */}
                  {!cameraError && (
                    <div className="absolute inset-0 pointer-events-none border-[50px] border-black/50 flex items-center justify-center">
                        <div className="w-64 h-64 border-4 border-blue-500/50 rounded-lg relative animate-pulse">
                            <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-blue-400"></div>
                            <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-blue-400"></div>
                            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-blue-400"></div>
                            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-blue-400"></div>
                        </div>
                    </div>
                  )}
                  {/* 錯誤訊息顯示 */}
                  {cameraError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                          <AlertTriangle size={64} className="text-amber-500 mb-4" />
                          <h3 className="text-2xl font-bold text-white mb-2">無法開啟相機</h3>
                          <p className="text-slate-300 text-lg mb-6">{cameraError}</p>
                          <div className="text-sm text-slate-500 bg-slate-800 p-4 rounded-xl text-left">
                              <p className="mb-2 font-bold">解決方案 (Chrome):</p>
                              <ol className="list-decimal pl-5 space-y-1">
                                  <li>網址列輸入: <code className="text-blue-400">chrome://flags</code></li>
                                  <li>搜尋 <code className="text-blue-400">unsafely-treat-insecure-origin-as-secure</code></li>
                                  <li>設為 <b>Enabled</b> 並在下方填入本機 IP</li>
                                  <li>重啟瀏覽器</li>
                              </ol>
                          </div>
                      </div>
                  )}
              </div>
              <button onClick={stopScanner} className="mt-8 bg-slate-800 hover:bg-slate-700 text-white px-8 py-4 rounded-full text-2xl font-black flex items-center gap-3 transition-all border border-slate-700">
                  <X size={32} /> 關閉相機
              </button>
          </div>
      )}

      {isPaused && (
        <div onClick={togglePause} className={`fixed inset-0 z-[200] backdrop-blur-md flex flex-col items-center justify-center cursor-pointer group animate-in fade-in duration-300 ${isDarkMode ? 'bg-slate-950/80' : 'bg-white/80'}`}>
          <div className="bg-amber-600 p-6 md:p-10 rounded-full md:rounded-[3rem] shadow-[0_0_80px_rgba(217,119,6,0.3)] group-hover:scale-110 transition-transform mb-4 md:mb-8">
            <Play size={60} className="md:w-[120px] md:h-[120px]" fill="currentColor" />
          </div>
          
          <h2 className={`text-5xl md:text-8xl font-black tracking-widest text-center ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>盤點暫停<br/><span className={`text-2xl md:text-4xl uppercase tracking-[0.5em] ${isDarkMode ? 'text-amber-500/60' : 'text-amber-600/40'}`}>Paused</span></h2>
          
          <div className={`mt-8 md:mt-12 flex items-center gap-3 md:gap-6 px-6 py-4 md:px-10 md:py-6 rounded-full border-2 md:border-4 shadow-2xl scale-90 md:scale-100 ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200'}`}>
            {syncStatus === 'syncing' && (
              <>
                <CloudSync size={32} className="md:w-[48px] md:h-[48px] text-blue-500 animate-spin" />
                <span className="text-xl md:text-3xl font-black text-blue-400 uppercase tracking-widest">備份同步中...</span>
              </>
            )}
            {syncStatus === 'success' && (
              <>
                <CheckCircle2 size={32} className="md:w-[48px] md:h-[48px] text-emerald-500 animate-bounce" />
                <span className="text-xl md:text-3xl font-black text-emerald-400 uppercase tracking-widest">備份已確認</span>
              </>
            )}
            {syncStatus === 'error' && (
              <>
                <CloudOff size={32} className="md:w-[48px] md:h-[48px] text-red-500" />
                <span className="text-xl md:text-3xl font-black text-red-500 uppercase tracking-widest">連線失敗</span>
              </>
            )}
            {syncStatus === 'idle' && (
              <span className="text-lg md:text-2xl font-bold text-slate-500 uppercase tracking-widest italic">等待變更...</span>
            )}
          </div>
          <p className="text-xl md:text-3xl font-bold text-amber-500 mt-8 md:mt-12 animate-pulse uppercase tracking-[0.2em] md:tracking-[0.4em]">點擊恢復作業</p>
        </div>
      )}

      {/* 頂部導航區 */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 md:mb-8 lg:mb-12 shrink-0 gap-4 md:gap-0">
        <div className="w-full md:w-auto overflow-x-auto custom-scrollbar pb-2 md:pb-0">
          <div className="flex gap-4 md:gap-8 lg:gap-12 items-stretch min-w-max">
            
            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className={`text-xs md:text-xl lg:text-3xl font-black uppercase tracking-widest pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>主題切換</span>
              <div className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-4 p-2 md:p-4 rounded-xl md:rounded-3xl lg:rounded-[3rem] border-2 md:border-4 lg:border-[8px] ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className={`flex p-1.5 rounded-xl border h-full ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'}`}>
                  <button onClick={() => setIsDarkMode(true)} className={`px-3 md:px-8 lg:px-14 rounded-lg md:rounded-2xl lg:rounded-3xl text-xs md:text-xl lg:text-3xl font-black transition-all flex items-center gap-1 md:gap-4 ${isDarkMode ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-600 hover:text-slate-900'}`}>
                    <Moon size={16} className="md:w-6 md:h-6 lg:w-10 lg:h-10" /> 黑色
                  </button>
                  <button onClick={() => setIsDarkMode(false)} className={`px-3 md:px-8 lg:px-14 rounded-lg md:rounded-2xl lg:rounded-3xl text-xs md:text-xl lg:text-3xl font-black transition-all flex items-center gap-1 md:gap-4 ${!isDarkMode ? 'bg-white text-slate-900 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}>
                    <Sun size={16} className="md:w-6 md:h-6 lg:w-10 lg:h-10" /> 白色
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className={`text-xs md:text-xl lg:text-3xl font-black uppercase tracking-widest pl-1 ${isDarkMode ? 'text-blue-500' : 'text-blue-800'}`}>STEP 1. 匯入</span>
              <label className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 px-6 md:px-12 lg:px-20 rounded-xl md:rounded-3xl lg:rounded-[3rem] cursor-pointer text-sm md:text-3xl lg:text-5xl font-black transition-all shadow-xl border-2 md:border-4 lg:border-[8px] ${data.length === 0 ? 'bg-blue-600 border-blue-400 hover:bg-blue-700 animate-pulse' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400 hover:border-blue-500' : 'bg-white border-slate-300 text-slate-700 hover:border-blue-600 shadow-sm')}`}>
                 <FileSpreadsheet size={24} className="md:w-10 md:h-10 lg:w-16 lg:h-16" /> 
                 {data.length === 0 ? "匯入" : "重讀"}
                 <input type="file" accept=".csv, .xlsx" onChange={(e) => {
                   const file = e.target.files?.[0]; if (!file) return;
                   const r = new FileReader();
                   r.onload = (ev) => {
                     const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
                     const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                     setData((json as any[]).map(row => ({
                       barcode: String(row['國際條碼'] || row['條碼編號'] || '').trim(),
                       productCode: String(row['款式代號'] || row['產品代號'] || '').trim(),
                       name: String(row['商品名稱'] || row['品名'] || row['名稱'] || '').trim(),
                       price: parseFloat(row['含稅定價'] || 0),
                       color: String(row['顏色'] || '').trim(),
                       size: String(row['尺寸'] || '').trim(),
                       bookQty: parseFloat(row['合計'] || row['期末數量'] || 0),
                       actualQty: 0,
                       diff: -parseFloat(row['合計'] || row['期末數量'] || 0),
                       originalRow: row
                     })));
                   };
                   r.readAsArrayBuffer(file);
                 }} className="hidden" />
              </label>
            </div>

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className={`text-xs md:text-xl lg:text-3xl font-black uppercase tracking-widest pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>STEP 2. 人員/倉庫</span>
              <div className={`h-16 md:h-24 lg:h-36 flex items-center border-2 md:border-4 lg:border-[8px] rounded-xl md:rounded-3xl lg:rounded-[3rem] focus-within:border-blue-500 transition-all px-4 md:px-10 lg:px-16 gap-2 md:gap-6 lg:gap-10 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 md:gap-4">
                    <User size={14} className="text-slate-600 md:w-6 md:h-6 lg:w-10 lg:h-10" />
                    <input type="text" value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="姓名" className={`bg-transparent text-sm md:text-2xl lg:text-4xl font-black outline-none w-16 md:w-40 lg:w-64 ${isDarkMode ? 'text-white placeholder:text-slate-700' : 'text-slate-900 placeholder:text-slate-500'}`} />
                  </div>
                  <div className={`flex items-center gap-1 md:gap-4 border-t mt-1 pt-1 md:mt-3 md:pt-3 ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
                    <Package size={14} className="text-slate-600 md:w-6 md:h-6 lg:w-10 lg:h-10" />
                    <input type="text" value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)} placeholder="倉庫" className={`bg-transparent text-sm md:text-2xl lg:text-4xl font-black outline-none w-16 md:w-40 lg:w-64 ${isDarkMode ? 'text-white placeholder:text-slate-700' : 'text-slate-900 placeholder:text-slate-500'}`} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className={`text-xs md:text-xl lg:text-3xl font-black uppercase tracking-widest pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>STEP 3. 設定</span>
              <div className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 p-2 md:p-4 rounded-xl md:rounded-3xl lg:rounded-[3rem] border-2 md:border-4 lg:border-[8px] ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className={`flex p-1.5 rounded-xl border h-full ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'}`}>
                  <button onClick={() => setTimeFormat('date')} className={`px-3 md:px-8 lg:px-14 rounded-lg md:rounded-2xl lg:rounded-3xl text-xs md:text-xl lg:text-3xl font-black transition-all ${timeFormat === 'date' ? (isDarkMode ? 'bg-slate-700 text-white shadow-lg' : 'bg-slate-300 text-slate-900 shadow-md') : 'text-slate-600 hover:text-slate-900'}`}>日期</button>
                  <button onClick={() => setTimeFormat('datetime')} className={`px-3 md:px-8 lg:px-14 rounded-lg md:rounded-2xl lg:rounded-3xl text-xs md:text-xl lg:text-3xl font-black transition-all flex items-center gap-1 md:gap-4 ${timeFormat === 'datetime' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-600 hover:text-slate-900'}`}><Clock size={14} className="md:w-6 md:h-6 lg:w-10 lg:h-10" />時間</button>
                </div>
                <button onClick={() => setLocationEnabled(!locationEnabled)} className={`h-full flex items-center gap-1 md:gap-4 lg:gap-8 px-4 md:px-10 lg:px-16 rounded-xl md:rounded-3xl lg:rounded-[2rem] transition-all font-black text-xs md:text-2xl lg:text-4xl border ${locationEnabled ? 'bg-amber-600 border-amber-400 text-white' : (isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-600' : 'bg-slate-100 border-slate-300 text-slate-700')}`}><MapPin size={16} className="md:w-10 md:h-10 lg:w-14 lg:h-14" />儲位</button>
              </div>
            </div>

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className={`text-xs md:text-xl lg:text-3xl font-black uppercase tracking-widest pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>除錯</span>
              <div className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 p-2 md:p-4 rounded-xl md:rounded-3xl lg:rounded-[3rem] border-2 md:border-4 lg:border-[8px] ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <button onClick={handleExportLogs} title="匯出紀錄" className={`h-full flex items-center justify-center aspect-square rounded-xl md:rounded-2xl lg:rounded-3xl transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}>
                  <Bug size={18} className="md:w-10 md:h-10 lg:w-16 lg:h-16" />
                </button>
                <button onClick={handleClearLogs} title="清除紀錄" className={`h-full flex items-center justify-center aspect-square rounded-xl md:rounded-2xl lg:rounded-3xl transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-red-400' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-red-500'}`}>
                  <RefreshCw size={18} className="md:w-10 md:h-10 lg:w-16 lg:h-16" />
                </button>
                <button onClick={handleClearAllData} title="重設所有資料" className={`h-full flex items-center justify-center aspect-square rounded-xl md:rounded-2xl lg:rounded-3xl transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-red-600' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-red-600'}`}>
                  <X size={18} className="md:w-10 md:h-10 lg:w-16 lg:h-16" />
                </button>
              </div>
            </div>

            <div className={`w-px mx-1 md:mx-4 lg:mx-8 self-center h-12 md:h-20 lg:h-32 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-300'}`} />

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className="text-xs md:text-xl lg:text-3xl font-black text-amber-500 uppercase tracking-widest pl-1">STEP 4. 暫停</span>
              <button onClick={togglePause} disabled={data.length === 0} className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 lg:gap-10 px-6 md:px-14 lg:px-20 rounded-xl md:rounded-3xl lg:rounded-[3rem] text-sm md:text-3xl lg:text-5xl font-black transition-all shadow-md border-2 md:border-4 lg:border-[8px] ${isPaused ? 'bg-amber-600 border-amber-400 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-amber-500 hover:bg-slate-800' : 'bg-white border-slate-300 text-amber-600 hover:bg-slate-100')} disabled:opacity-30`}>{isPaused ? <Play size={18} className="md:w-10 md:h-10 lg:w-16 lg:h-16" /> : <Pause size={18} className="md:w-10 md:h-10 lg:w-16 lg:h-16" />}</button>
            </div>

            <div className="flex flex-col gap-1 md:gap-3 lg:gap-6">
              <span className="text-xs md:text-xl lg:text-3xl font-black text-red-500 uppercase tracking-widest pl-1">STEP 5. 結束</span>
              <div className="flex gap-2 md:gap-6">
                <button onClick={handleEndJob} disabled={data.length === 0} className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 lg:gap-10 px-4 md:px-10 lg:px-16 rounded-xl md:rounded-3xl lg:rounded-[3rem] text-xs md:text-2xl lg:text-4xl font-black transition-all shadow-md border-2 md:border-4 lg:border-[8px] ${data.length > 0 ? 'bg-red-600 border-red-400 hover:bg-red-700 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-white border-slate-300 text-slate-400 cursor-not-allowed')}`} title="匯出 Excel 並結束">
                  <LogOut size={18} className="md:w-8 md:h-8 lg:w-12 lg:h-12" /> 結束
                </button>
                <button onClick={handleExportMachineFormat} disabled={data.length === 0} className={`h-16 md:h-24 lg:h-36 flex items-center gap-2 md:gap-6 lg:gap-10 px-4 md:px-10 lg:px-16 rounded-xl md:rounded-3xl lg:rounded-[3rem] text-xs md:text-2xl lg:text-4xl font-black transition-all shadow-md border-2 md:border-4 lg:border-[8px] ${data.length > 0 ? 'bg-indigo-600 border-indigo-400 hover:bg-indigo-700 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-white border-slate-300 text-slate-400 cursor-not-allowed')}`} title="匯出盤點機 TXT 格式">
                  <FileDown size={18} className="md:w-8 md:h-8 lg:w-12 lg:h-12" /> TXT
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex flex-col items-end text-right pb-1">
            <h1 className="text-3xl lg:text-6xl font-black tracking-tighter text-white leading-none mb-3">大豐資訊盤點系統</h1>
            <div className="bg-blue-600/20 text-blue-500 font-bold px-6 py-2 rounded-full text-xl lg:text-2xl tracking-[0.4em] uppercase border border-blue-500/30">雲端備份就緒</div>
        </div>
        {/* 手機版標題簡化 */}
        <div className="md:hidden w-full flex justify-between items-center mt-2 px-1">
            <h1 className="text-xl font-black tracking-tight text-white">大豐資訊盤點系統</h1>
            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]"></div>
        </div>
      </header>

      {/* 掃描列 */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 lg:gap-8 mb-4 md:mb-6 lg:mb-10 shrink-0">
        <section className={`flex-1 flex p-2 md:p-3 lg:p-4 rounded-2xl md:rounded-3xl lg:rounded-[4rem] transition-all duration-300 border-2 md:border-4 lg:border-[8px] items-center ${isSuccess ? 'bg-emerald-500/20 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]' : isPaused ? (isDarkMode ? 'bg-slate-950 border-slate-900' : 'bg-slate-100 border-slate-200') : (isDarkMode ? 'bg-slate-900 border-slate-800 focus-within:border-blue-500' : 'bg-white border-slate-300 focus-within:border-blue-600 shadow-sm')}`}>
          <div 
            className={`flex items-center rounded-xl md:rounded-2xl lg:rounded-[3rem] px-3 md:px-6 lg:px-10 gap-2 md:gap-4 lg:gap-6 ml-1 md:ml-2 lg:ml-4 border shadow-inner cursor-text py-2 md:py-2 lg:py-2 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
            onClick={(e) => {
              e.stopPropagation(); 
              qtyRef.current?.focus();
            }}
          >
            <Hash className="text-blue-500 w-5 h-5 md:w-8 md:h-8 lg:w-12 lg:h-12" />
            <input 
              ref={qtyRef}
              type="number" 
              value={scanQty} 
              onChange={(e) => setScanQty(e.target.value)}
              onFocus={(e) => e.target.select()} 
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  inputRef.current?.focus(); 
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={`bg-transparent text-2xl md:text-4xl lg:text-6xl font-black w-12 md:w-20 lg:w-32 outline-none text-center ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}
              placeholder="1"
            />
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setScanQty('');
                qtyRef.current?.focus();
              }}
              className={`transition-colors text-lg md:text-3xl lg:text-4xl font-black px-1 ${isDarkMode ? 'text-slate-700 hover:text-red-500' : 'text-slate-400 hover:text-red-600'}`}
            >
              X
            </button>
          </div>
          <form onSubmit={handleScan} className="flex-1 relative ml-2 flex items-center">
            <Search className="absolute left-2 md:left-4 lg:left-6 text-blue-500 w-5 h-5 md:w-10 md:h-10 lg:w-16 lg:h-16 pointer-events-none" />
            <input 
              ref={inputRef}
              type="text" 
              value={inputValue} 
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isPaused ? "暫停..." : data.length > 0 ? "掃描..." : "請先匯入"}
              disabled={data.length === 0 || isPaused}
              className={`w-full bg-transparent pl-9 md:pl-16 lg:pl-24 pr-14 md:pr-4 py-3 md:py-6 lg:py-12 text-2xl md:text-5xl lg:text-7xl font-black outline-none h-14 md:h-24 lg:h-auto ${isDarkMode ? 'text-white placeholder:text-slate-800' : 'text-slate-900 placeholder:text-slate-400'}`}
              autoComplete="off"
            />
            
            {/* 掃描按鈕 (顯示於輸入框右側) */}
            <button 
                type="button" 
                onClick={startScanner}
                disabled={data.length === 0 || isPaused}
                className={`absolute right-0 md:static md:ml-4 lg:ml-8 p-2.5 md:p-6 lg:p-10 rounded-full md:rounded-3xl lg:rounded-[2.5rem] transition-all border shadow-lg disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-white border-slate-700' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'}`}
                title="開啟相機掃描"
            >
                <Camera size={20} className="md:w-10 md:h-10 lg:w-[64px] lg:h-[64px]" />
            </button>
          </form>
        </section>

        {locationEnabled && (
          <section className={`w-full md:w-1/4 p-2 md:p-3 lg:p-4 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-row md:flex-col items-center md:justify-center px-4 md:px-10 lg:px-16 gap-3 md:gap-0 border-2 md:border-4 lg:border-[8px] transition-all ${isDarkMode ? 'bg-amber-900/10 border-amber-800/50' : 'bg-amber-50 border-amber-200 shadow-sm'}`}>
            <div className={`flex items-center gap-1.5 md:gap-3 lg:gap-6 md:mb-2 lg:mb-4 font-black text-base md:text-2xl lg:text-4xl uppercase tracking-widest shrink-0 ${isDarkMode ? 'text-amber-500' : 'text-amber-600'}`}><MapPin size={20} className="md:w-8 md:h-8 lg:w-[48px] lg:h-[48px]" /> <span className="hidden md:inline">目前</span>儲位</div>
            <input 
              ref={locationRef}
              type="text" 
              value={currentLocation} 
              onChange={(e) => setCurrentLocation(e.target.value)} 
              onClick={(e) => e.stopPropagation()}
              placeholder="位置..." 
              disabled={isPaused} 
              className={`w-full bg-transparent text-3xl md:text-5xl lg:text-7xl font-black outline-none ${isDarkMode ? 'text-amber-400 placeholder:text-amber-900' : 'text-amber-700 placeholder:text-amber-300'}`} 
              autoComplete="off" 
            />
          </section>
        )}
      </div>

      {/* 中央主工作區：手機版垂直堆疊 (Grid 1 col)，電腦版左右分割 (Grid 12 cols) */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 lg:gap-8 min-h-0 mb-4 md:mb-4 lg:mb-6 shrink-0">
        {/* 上方/左方：產品資訊 */}
        <div className={`col-span-1 lg:col-span-8 border-2 md:border-3 lg:border-4 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col overflow-hidden relative shadow-2xl min-h-[300px] md:min-h-0 transition-all ${isDarkMode ? 'bg-slate-900/40 border-slate-800/50' : 'bg-white border-slate-200'}`}>
          {lastScanned ? (
            <div className="h-full flex flex-col">
              <div className={`flex-1 border-b-2 flex flex-col justify-center px-6 md:px-10 lg:px-16 py-6 md:py-4 lg:py-0 ${isDarkMode ? 'border-slate-800/50 bg-slate-800/10' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`flex items-center gap-2 md:gap-3 lg:gap-4 mb-1 md:mb-2 font-black text-base md:text-lg lg:text-xl uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-700'}`}><Package size={18} className="md:w-6 md:h-6 lg:w-[28px] lg:h-[28px]" /> 商品名稱</div>
                <h2 className={`text-xl md:text-2xl lg:text-4xl font-black truncate drop-shadow-xl leading-tight whitespace-normal md:whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{lastScanned.name}</h2>
                <div className="flex gap-2 md:gap-4 mt-1 md:mt-2">
                  {lastScanned.color && <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-lg text-sm md:text-base lg:text-lg font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>顏色: {lastScanned.color}</span>}
                  {lastScanned.size && <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-lg text-sm md:text-base lg:text-lg font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>尺寸: {lastScanned.size}</span>}
                  {lastScanned.price && <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-lg text-sm md:text-base lg:text-lg font-bold ${isDarkMode ? 'bg-slate-800 text-amber-500' : 'bg-amber-100 text-amber-800'}`}>定價: ${lastScanned.price}</span>}
                </div>
              </div>
              <div className={`flex-1 border-b-2 flex flex-col justify-center px-6 md:px-10 lg:px-16 py-6 md:py-4 lg:py-0 ${isDarkMode ? 'border-slate-800/50' : 'border-slate-200'}`}>
                <div className={`flex items-center gap-2 md:gap-3 lg:gap-4 mb-1 md:mb-2 font-black text-lg md:text-2xl lg:text-3xl uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-700'}`}><Info size={18} className="md:w-6 md:h-6 lg:w-[28px] lg:h-[28px]" /> 款式代號 / 條碼</div>
                <p className="text-2xl md:text-4xl lg:text-6xl font-black text-blue-400 font-mono tracking-tighter leading-none break-all">{lastScanned.productCode}</p>
                <p className={`text-lg md:text-2xl lg:text-4xl font-bold font-mono mt-2 md:mt-4 ${isDarkMode ? 'text-slate-600' : 'text-slate-800'}`}>{lastScanned.barcode}</p>
              </div>
            </div>
          ) : (
            <div className={`h-full flex flex-col items-center justify-center py-10 md:py-0 ${isDarkMode ? 'opacity-10' : 'opacity-30'}`}>
              <ScanBarcode size={80} className={`md:w-32 md:h-32 lg:w-[180px] lg:h-[180px] ${isDarkMode ? 'text-white' : 'text-slate-900'}`} />
              <p className={`text-xl md:text-3xl lg:text-5xl font-black mt-4 md:mt-8 tracking-[0.5em] uppercase text-center ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>掃描就緒</p>
            </div>
          )}
        </div>

        {/* 下方/右方：數量統計 */}
        <div className="col-span-1 lg:col-span-4 flex flex-row lg:flex-col gap-4 md:gap-6 lg:gap-8 h-32 md:h-40 lg:h-auto">
          <div className="flex-1 bg-blue-600 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col items-center justify-center shadow-2xl relative p-3 md:p-4">
            <span className="text-blue-100 font-black text-sm md:text-xl lg:text-2xl mb-1 md:mb-2 lg:mb-4 uppercase tracking-[0.2em] md:tracking-[0.4em]">累計數量</span>
            <div className="text-3xl md:text-5xl lg:text-7xl font-black drop-shadow-2xl text-white leading-none">{lastScanned?.actualQty ?? '0'}</div>
            {lastScanned && (
              <button onClick={manualSetTotalQty} className={`absolute bottom-2 right-2 md:bottom-6 md:right-6 lg:bottom-10 lg:right-10 px-2 py-1 md:px-4 md:py-2 lg:px-6 lg:py-4 rounded-lg md:rounded-2xl lg:rounded-3xl transition-all flex items-center gap-1 md:gap-2 lg:gap-3 text-xs md:text-xl lg:text-2xl font-black backdrop-blur-md shadow-2xl border-2 ${isDarkMode ? 'bg-white/20 hover:bg-white text-white hover:text-blue-600 border-white/20' : 'bg-blue-700/20 hover:bg-blue-700 text-blue-700 hover:text-white border-blue-700/20'}`}><Edit3 size={14} className="md:w-6 md:h-6 lg:w-[32px] lg:h-[32px]" /> 修正</button>
            )}
          </div>
          <div className={`flex-1 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col items-center justify-center shadow-2xl transition-all duration-500 p-3 md:p-4 ${!lastScanned ? (isDarkMode ? 'bg-slate-800 text-slate-700' : 'bg-slate-100 text-slate-600') : lastScanned.diff === 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
            <span className={`font-black text-sm md:text-xl lg:text-2xl mb-1 md:mb-2 lg:mb-4 uppercase tracking-[0.2em] md:tracking-[0.4em] ${!lastScanned ? (isDarkMode ? 'text-slate-700' : 'text-slate-400') : 'text-white opacity-80'}`}>庫存差異</span>
            <div className={`text-3xl md:text-5xl lg:text-7xl font-black leading-none ${!lastScanned ? (isDarkMode ? 'text-slate-700' : 'text-slate-400') : 'text-white'}`}>{lastScanned ? (lastScanned.diff > 0 ? `+${lastScanned.diff}` : lastScanned.diff) : '0'}</div>
          </div>
        </div>
      </main>

      {/* 底部數據：手機版改為 Grid 2欄，電腦版 3欄 */}
      <footer className="grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-8 lg:gap-12 shrink-0 h-auto md:h-56 lg:h-80 mb-20 md:mb-4">
        <div className={`col-span-1 border-2 md:border-4 lg:border-[8px] rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center px-4 md:px-10 lg:px-20 gap-3 md:gap-10 lg:gap-20 shadow-2xl py-4 md:py-0 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <Package className={`w-8 h-8 md:w-20 md:h-20 lg:w-36 lg:h-36 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`} />
          <div>
            <p className={`text-xs md:text-2xl lg:text-4xl font-black uppercase mb-1 md:mb-3 lg:mb-6 tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>總項數</p>
            <p className={`text-2xl md:text-7xl lg:text-[10rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.length}</p>
          </div>
        </div>
        <div className={`col-span-1 border-2 md:border-4 lg:border-[8px] rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center px-4 md:px-10 lg:px-20 gap-3 md:gap-10 lg:gap-20 shadow-2xl py-4 md:py-0 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <ClipboardCheck className={`w-8 h-8 md:w-20 md:h-20 lg:w-36 lg:h-36 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`} />
          <div>
            <p className={`text-xs md:text-2xl lg:text-4xl font-black uppercase mb-1 md:mb-3 lg:mb-6 tracking-widest ${isDarkMode ? 'text-emerald-600' : 'text-emerald-700'}`}>已完成</p>
            <p className={`text-2xl md:text-7xl lg:text-[10rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.filter(i => i.actualQty > 0).length}</p>
          </div>
        </div>
        <button onClick={() => setShowUnscannedList(true)} className={`col-span-2 lg:col-span-1 border-2 md:border-4 lg:border-[8px] hover:border-amber-500 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center justify-center lg:justify-start px-4 md:px-10 lg:px-20 gap-3 md:gap-10 lg:gap-20 transition-all group shadow-2xl py-4 md:py-0 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <AlertCircle className="text-amber-500 group-hover:scale-110 transition-transform w-8 h-8 md:w-20 md:h-20 lg:w-36 lg:h-36" />
          <div className="text-left">
            <p className={`text-xs md:text-2xl lg:text-4xl font-black uppercase mb-1 md:mb-3 lg:mb-6 tracking-widest ${isDarkMode ? 'text-amber-600' : 'text-amber-700'}`}>未盤項 (檢視)</p>
            <p className={`text-2xl md:text-7xl lg:text-[10rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.filter(i => i.actualQty === 0 && i.bookQty > 0).length}</p>
          </div>
        </button>
      </footer>

      {/* Unscanned List Modal */}
      {showUnscannedList && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden ${isDarkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
            <div className={`p-4 border-b flex justify-between items-center ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold">未清點項目清單</h3>
              </div>
              <button 
                onClick={() => setShowUnscannedList(false)}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-200'}`}
              >
                <X className={`w-6 h-6 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {data.filter(i => i.bookQty > 0 && i.actualQty === 0).length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3 opacity-20" />
                  <p>所有應盤項目皆已清點！</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.filter(i => i.bookQty > 0 && i.actualQty === 0).map((item, idx) => (
                    <div key={idx} className={`p-3 border rounded-xl transition-colors ${isDarkMode ? 'border-slate-800 hover:bg-slate-800/50' : 'border-slate-200 hover:bg-slate-100'}`}>
                      <div className="flex justify-between items-start">
                        <div className="overflow-hidden">
                          <p className={`font-bold truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.name}</p>
                          <p className={`text-sm font-mono truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>{item.productCode} | {item.barcode}</p>
                          <div className="flex gap-2 mt-1">
                            {item.color && <span className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-700'}`}>{item.color}</span>}
                            {item.size && <span className={`text-xs px-2 py-0.5 rounded ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-700'}`}>{item.size}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-xs ${isDarkMode ? 'text-slate-600' : 'text-slate-500'}`}>應有數量</p>
                          <p className="font-bold text-amber-600">{item.bookQty}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={`p-4 border-t flex justify-between items-center ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300'}`}>
              <p className={`text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>
                共 {data.filter(i => i.bookQty > 0 && i.actualQty === 0).length} 項未清點
              </p>
              <button 
                onClick={() => setShowUnscannedList(false)}
                className={`px-6 py-2 rounded-xl font-bold transition-all ${isDarkMode ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-slate-800 text-white hover:bg-slate-900'}`}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 彈窗內容：針對手機版做寬度與 Padding 調整 */}
      {showMappingModal && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/95 backdrop-blur-2xl p-4 md:p-10">
          <div className={`w-full max-w-7xl rounded-3xl md:rounded-[5rem] overflow-hidden flex flex-col shadow-2xl border-4 md:border-[12px] max-h-[95vh] ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-slate-300'}`}>
            <div className="p-6 md:p-12 bg-red-600 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div><h3 className="text-2xl md:text-6xl font-black mb-1 md:mb-3 italic break-all">! 未知: {unknownBarcode}</h3><p className="text-lg md:text-3xl font-bold opacity-80">請手動選擇或建立新項。</p></div>
              <div className="flex gap-2 md:gap-8 w-full md:w-auto">
                <button onClick={() => setIsCreatingNew(false)} className={`flex-1 md:flex-none px-4 md:px-12 py-3 md:py-6 rounded-xl md:rounded-3xl font-black text-lg md:text-3xl transition-all ${!isCreatingNew ? 'bg-white text-red-600 shadow-2xl scale-105 md:scale-110' : 'bg-red-700 text-red-200'}`}>搜尋</button>
                <button onClick={() => setIsCreatingNew(true)} className={`flex-1 md:flex-none px-4 md:px-12 py-3 md:py-6 rounded-xl md:rounded-3xl font-black text-lg md:text-3xl transition-all ${isCreatingNew ? 'bg-white text-red-600 shadow-2xl scale-105 md:scale-110' : 'bg-red-700 text-red-200'}`}>新建</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex min-h-[400px] md:min-h-[600px]">
              {isCreatingNew ? (
                <div className={`flex-1 p-6 md:p-24 flex flex-col justify-center overflow-y-auto ${isDarkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
                  <div className="max-w-3xl mx-auto w-full space-y-4 md:space-y-10">
                    <div className="grid grid-cols-2 gap-4 md:gap-8">
                      <div className={`p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-inner border-2 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-200 border-slate-400'}`}><label className="block text-sm md:text-xl font-black text-slate-500 mb-1 md:mb-2 uppercase">未知條碼</label><p className={`text-xl md:text-4xl font-black break-all ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{unknownBarcode}</p></div>
                      <div className={`p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-inner border-2 ${isDarkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-100 border-blue-300'}`}><label className="block text-sm md:text-xl font-black text-blue-600 mb-1 md:mb-2 uppercase">掃描數量</label><p className={`text-xl md:text-4xl font-black ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>{scanQty}</p></div>
                    </div>
                    <div><label className={`block text-lg md:text-2xl font-black mb-1 md:mb-3 uppercase ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>產品型號 (必填)</label><input autoFocus type="text" value={newProductCode} onChange={(e) => setNewProductCode(e.target.value)} placeholder="輸入型號..." className={`w-full px-6 md:px-12 py-4 md:py-8 text-2xl md:text-5xl font-black border-4 md:border-8 rounded-2xl md:rounded-[2.5rem] outline-none focus:border-blue-600 shadow-2xl transition-all ${isDarkMode ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-800' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-500'}`} /></div>
                    <div><label className={`block text-lg md:text-2xl font-black mb-1 md:mb-3 uppercase ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>品名 (必填)</label><input type="text" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} placeholder="輸入品名..." className={`w-full px-6 md:px-12 py-4 md:py-8 text-2xl md:text-5xl font-black border-4 md:border-8 rounded-2xl md:rounded-[2.5rem] outline-none focus:border-blue-600 shadow-2xl transition-all ${isDarkMode ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-800' : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-500'}`} /></div>
                    <button onClick={handleCreateNewItem} className="w-full py-6 md:py-10 bg-blue-600 text-white rounded-2xl md:rounded-[2.5rem] text-3xl md:text-5xl font-black shadow-2xl hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-4 md:gap-6"><PlusCircle size={32} className="md:w-[64px] md:h-[64px]" /> 儲存</button>
                </div></div>
              ) : (
                <div className="flex-1 flex flex-col">
                  <div className={`p-4 md:p-12 border-b-4 md:border-b-8 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300'}`}><input autoFocus type="text" value={mappingSearch} onChange={(e) => setMappingSearch(e.target.value)} placeholder="搜尋型號或品名..." className={`w-full px-6 md:px-16 py-4 md:py-10 text-2xl md:text-5xl font-black rounded-2xl md:rounded-[3rem] border-4 md:border-8 border-transparent focus:border-blue-600 outline-none shadow-2xl ${isDarkMode ? 'bg-slate-950 text-white placeholder:text-slate-800' : 'bg-white text-slate-900 placeholder:text-slate-500'}`} /></div>
                  <div className={`flex-1 overflow-y-auto p-4 md:p-10 custom-scrollbar ${isDarkMode ? 'bg-slate-950' : 'bg-white'}`}>
                    {data.filter(i => 
                      i.productCode.toLowerCase().includes(mappingSearch.toLowerCase()) || 
                      i.name.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                      i.barcode.includes(mappingSearch)
                    ).slice(0, 15).map((item, idx) => (
                      <button key={idx} onClick={() => {
                        const dIdx = data.findIndex(d => d.productCode === item.productCode);
                        const updated = [...data];
                        updated[dIdx].mappedBarcodes = [...(updated[dIdx].mappedBarcodes || []), unknownBarcode];
                        updated[dIdx].actualQty += parseFloat(scanQty) || 1;
                        updated[dIdx].diff = updated[dIdx].actualQty - updated[dIdx].bookQty;
                        if (locationEnabled && currentLocation.trim()) updated[dIdx].location = currentLocation.trim();
                        if (operatorName.trim()) updated[dIdx].operator = operatorName.trim();
                        const t = getFormattedTime(); if (t) updated[dIdx].scanTime = t;
                        setData(updated); setLastScanned(updated[dIdx]); setShowMappingModal(false); audioService.speakMappingSuccess();
                      }} className={`w-full text-left p-6 md:p-10 hover:bg-blue-600 hover:text-white rounded-2xl md:rounded-[3rem] border-b-2 md:border-b-4 flex justify-between items-center transition-all mb-4 md:mb-6 group shadow-md hover:shadow-2xl ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                        <div className="overflow-hidden">
                          <div className={`text-xl md:text-4xl font-black mb-1 md:mb-2 truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{item.productCode}</div>
                          <div className={`text-lg md:text-2xl font-bold opacity-60 group-hover:opacity-100 truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>{item.name}</div>
                          <div className="text-sm font-mono opacity-40 group-hover:opacity-80">{item.barcode}</div>
                        </div>
                        <Link size={32} className="md:w-[64px] md:h-[64px] text-blue-600 group-hover:text-white shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className={`p-4 md:p-12 text-center border-t-4 md:border-t-8 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300'}`}><button onClick={() => setShowMappingModal(false)} className={`w-full md:w-auto px-12 md:px-24 py-4 md:py-6 rounded-full font-black text-xl md:text-3xl transition-colors shadow-2xl ${isDarkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-slate-600 text-white hover:bg-slate-700'}`}>放棄</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
