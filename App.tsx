
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  FileDown, CheckCircle2, Search,
  ScanBarcode, FileSpreadsheet, X,
  Link, Info, Package, ClipboardCheck, AlertCircle, PlusCircle, MapPin, Clock, User,
  Pause, Play, LogOut, Edit3, Hash, CloudSync, CloudCheck, CloudOff, Menu,
  RefreshCw, AlertTriangle, Terminal, Bug, FileUp,
  Sun, Moon, BookOpen, ChevronRight, LayoutDashboard, TrendingUp, TrendingDown, DollarSign, BarChart3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid 
} from 'recharts';
import { InventoryItem, LogEntry } from './types';
import { audioService } from './services/audioService';

const STORAGE_KEY = 'dafeng_inventory_local_v11';
const LOGS_KEY = 'dafeng_inventory_logs_v1';

type TimeFormat = 'off' | 'datetime' | 'date';
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

const APP_VERSION = "v1.2.5";
const UPDATE_NOTES = [
  "優化 RWD 響應式佈局，適配筆記型電腦與行動裝置。",
  "強化淺色模式（白色背景）下的視覺對比度與易讀性。",
  "新增軟體更新說明與使用教學功能。",
  "優化掃描邏輯與語音提示，提升作業效率。",
  "修正部分已知介面顯示問題。"
];

const GUIDE_STEPS = [
  {
    title: "步驟 1：匯入盤點資料",
    content: "點擊頂端「匯入」按鈕，上傳包含產品型號、條碼、品名、顏色、尺寸及帳面數量的 Excel 或 CSV 檔案。系統將自動解析並建立盤點清單。"
  },
  {
    title: "步驟 2：設定人員與倉庫",
    content: "在「人員/倉庫」欄位輸入您的姓名與目前作業的倉庫代碼（預設為 T0300）。這些資訊將包含在最終匯出的報表中。"
  },
  {
    title: "步驟 3：開始掃描盤點",
    content: "確保「暫停」狀態已解除。在掃描框中輸入條碼進行掃描。系統會自動比對資料，累加實盤數量並即時計算庫存差異。"
  },
  {
    title: "步驟 4：處理未知條碼",
    content: "若掃描到不在清單中的條碼，系統會彈出對應視窗。您可以選擇「搜尋」現有產品進行條碼綁定，或選擇「新建」直接建立新的產品品項。"
  },
  {
    title: "步驟 5：檢視與匯出",
    content: "作業中可點擊底部「未盤項」查看尚未清點的貨品。完成後點擊「結束」按鈕，系統將產生包含所有盤點數據的 Excel 報表供下載。"
  }
];

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
  const [workIdSuffix, setWorkIdSuffix] = useState('FT015');
  const [fileSuffix, setFileSuffix] = useState('0 00000021');
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [currentLocation, setCurrentLocation] = useState('');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('date');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // Refs to avoid stale closures
  const dataRef = useRef(data);
  const configRef = useRef({ scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode });

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    configRef.current = { scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode };
  }, [scanQty, locationEnabled, currentLocation, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode]);
  
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

    if (inputRef.current && !showUnscannedList && !showMappingModal && !isPaused) {
      inputRef.current.focus();
    }
  }, [showUnscannedList, showMappingModal, isPaused]);

  useEffect(() => {
    focusInput();
    const h = () => focusInput();
    window.addEventListener('click', h);
    return () => {
      window.removeEventListener('click', h);
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

  const getInventoryDate = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  };

  const getFormattedTime = () => {
    if (timeFormat === 'off') return undefined;
    
    // 取得當前時間並調整為 T-1 (前一天)，以符合盤點抓取前一天庫存的需求
    const dateObj = getInventoryDate();
    
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    
    if (timeFormat === 'date') return `${y}/${m}/${d}`;
    
    // 若為 datetime 格式，日期顯示 T-1，時間則保留掃描當下的時分
    const now = new Date();
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
    } else {
      // 未知條碼
      addLog('error', `未知條碼: ${targetCode}`, { qty: currentAddQty });
      setUnknownBarcode(targetCode);
      setNewProductName('');
      setNewProductCode('');
      setIsCreatingNew(false);
      setShowMappingModal(true);
      audioService.speakError();
    }
  };

  // 表單提交 (USB 槍)
  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    processBarcode(inputValue);
    setInputValue('');
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
    const invDate = getInventoryDate();
    const dateStr = `${invDate.getFullYear()}${(invDate.getMonth() + 1).toString().padStart(2, '0')}${invDate.getDate().toString().padStart(2, '0')}`;
    
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
    XLSX.writeFile(wb, `大豐盤點_${dateStr}.xlsx`);
    addLog('info', '匯出 Excel 報表', { itemCount: data.length });
  };

  const handleExportMachineFormat = () => {
    if (data.length === 0) return;
    
    const invDate = getInventoryDate();
    const yyyymmdd = invDate.getFullYear().toString() + 
                     (invDate.getMonth() + 1).toString().padStart(2, '0') + 
                     invDate.getDate().toString().padStart(2, '0');
    
    const workId = `${yyyymmdd}${workIdSuffix}`;
    const suffix = fileSuffix;
    
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

    const content = lines.join('\r\n') + '\r\n';
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

  const handleRepairTxt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (!content) return;

      // 1. 統一換行符號為 \r\n (Windows 格式)
      // 2. 確保結尾有換行
      // 3. 嘗試替換硬編碼的後綴 (選用)
      let repaired = content.replace(/\r?\n/g, '\r\n');
      
      // 如果使用者有設定新的後綴，嘗試在轉檔時替換舊的 (假設舊的是 FT015)
      if (workIdSuffix !== 'FT015') {
        repaired = repaired.replace(/FT015/g, workIdSuffix);
      }
      if (fileSuffix !== '0 00000021') {
        repaired = repaired.replace(/0 00000021/g, fileSuffix);
      }

      if (!repaired.endsWith('\r\n')) {
        repaired += '\r\n';
      }

      const blob = new Blob([repaired], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FIXED_${file.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog('info', '執行 TXT 格式修復轉檔', { fileName: file.name });
      alert('轉檔完成！請使用下載的 FIXED_' + file.name + ' 匯入 ERP。');
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
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
      
      {isPaused && (
        <div onClick={togglePause} className={`fixed inset-0 z-[200] backdrop-blur-md flex flex-col items-center justify-center cursor-pointer group animate-in fade-in duration-300 ${isDarkMode ? 'bg-slate-950/80' : 'bg-white/80'}`}>
          <div className="bg-amber-600 p-6 md:p-10 rounded-full md:rounded-[3rem] shadow-[0_0_80px_rgba(217,119,6,0.3)] group-hover:scale-110 transition-transform mb-4 md:mb-8">
            <Play size={60} className="md:w-[120px] md:h-[120px]" fill="currentColor" />
          </div>
          
          <h2 className={`text-5xl md:text-8xl font-black tracking-widest text-center ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>盤點暫停<br/><span className={`text-2xl md:text-4xl uppercase tracking-[0.5em] ${isDarkMode ? 'text-amber-500/60' : 'text-amber-600/40'}`}>Paused</span></h2>
          
          <div className={`mt-8 md:mt-12 flex items-center gap-3 md:gap-6 px-6 py-4 md:px-10 md:py-6 rounded-full border-2 ${isDarkMode ? 'bg-slate-900/40 border-slate-800' : 'bg-white/40 border-slate-200'}`}>
            <div className={`w-3 h-3 md:w-5 md:h-5 rounded-full animate-pulse ${syncStatus === 'syncing' ? 'bg-blue-500 shadow-[0_0_15px_#3b82f6]' : syncStatus === 'error' ? 'bg-red-500 shadow-[0_0_15px_#ef4444]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`} />
            <span className={`text-lg md:text-2xl font-bold tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {syncStatus === 'syncing' ? '雲端同步中...' : syncStatus === 'error' ? '同步發生錯誤' : '資料已安全備份'}
            </span>
          </div>

          {/* 暫停時的手動存檔區 */}
          <div className="flex flex-col md:flex-row gap-4 mt-8 md:mt-12">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleExport();
              }}
              className={`flex items-center justify-center gap-3 px-8 py-4 md:px-12 md:py-6 rounded-2xl md:rounded-3xl font-black text-xl md:text-4xl transition-all shadow-2xl border-2 ${isDarkMode ? 'bg-blue-600 border-blue-400 text-white hover:bg-blue-700' : 'bg-blue-500 border-blue-300 text-white hover:bg-blue-600'}`}
            >
              <FileDown size={24} className="md:w-10 md:h-10" />
              立即存檔 (Excel)
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleExportMachineFormat();
              }}
              className={`flex items-center justify-center gap-3 px-8 py-4 md:px-12 md:py-6 rounded-2xl md:rounded-3xl font-black text-xl md:text-4xl transition-all shadow-2xl border-2 ${isDarkMode ? 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-700' : 'bg-indigo-500 border-indigo-300 text-white hover:bg-indigo-600'}`}
            >
              <FileDown size={24} className="md:w-10 md:h-10" />
              存檔 (TXT)
            </button>
          </div>
          
          <div className={`mt-10 md:mt-16 px-8 py-4 md:px-12 md:py-6 rounded-2xl border-2 animate-bounce ${isDarkMode ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
            <span className="text-xl md:text-3xl font-black tracking-widest">點擊背景任意處繼續盤點</span>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row md:flex-wrap justify-between items-start md:items-center mb-2 md:mb-4 lg:mb-6 xl:mb-6 shrink-0 gap-2 md:gap-4 lg:gap-4">
        <div className="w-full md:w-auto pb-1 md:pb-0 shrink-0">
          <div className="flex flex-wrap gap-1.5 md:gap-2 lg:gap-3 xl:gap-4 items-stretch">
            
            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>主題</span>
              <div className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 p-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className={`flex p-0.5 rounded-md border h-full ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'}`}>
                  <button onClick={() => setIsDarkMode(true)} className={`px-2 md:px-4 lg:px-6 xl:px-8 rounded-sm md:rounded-lg text-[10px] md:text-sm lg:text-base xl:text-lg font-black transition-all flex items-center gap-1.5 ${isDarkMode ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                    <Moon size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" /> 黑色
                  </button>
                  <button onClick={() => setIsDarkMode(false)} className={`px-2 md:px-4 lg:px-6 xl:px-8 rounded-sm md:rounded-lg text-[10px] md:text-sm lg:text-base xl:text-lg font-black transition-all flex items-center gap-1.5 ${!isDarkMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                    <Sun size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" /> 白色
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-blue-500' : 'text-blue-800'}`}>S1. 匯入</span>
              <label className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-2 px-3 md:px-6 lg:px-8 xl:px-10 rounded-lg cursor-pointer text-xs md:text-xl lg:text-2xl xl:text-3xl font-black transition-all shadow-sm border ${data.length === 0 ? 'bg-blue-600 border-blue-400 hover:bg-blue-700 animate-pulse text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400 hover:border-blue-500' : 'bg-white border-slate-300 text-slate-700 hover:border-blue-600 shadow-sm')}`}>
                 <FileSpreadsheet size={16} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" /> 
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

            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>S2. 人員/倉庫</span>
              <div className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center border rounded-lg focus-within:border-blue-500 transition-all px-3 md:px-6 lg:px-8 xl:px-10 gap-3 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-slate-600 md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-8 xl:h-8" />
                    <input type="text" value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="姓名" className={`bg-transparent text-xs md:text-2xl lg:text-3xl xl:text-4xl font-black outline-none w-16 md:w-32 lg:w-48 xl:w-64 ${isDarkMode ? 'text-white placeholder:text-slate-700' : 'text-slate-900 placeholder:text-slate-500'}`} />
                  </div>
                  <div className={`flex items-center gap-2 border-t mt-1.5 pt-1.5 ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
                    <Package size={14} className="text-slate-600 md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-8 xl:h-8" />
                    <input type="text" value={warehouseCode} onChange={(e) => setWarehouseCode(e.target.value)} placeholder="倉庫" className={`bg-transparent text-xs md:text-2xl lg:text-3xl xl:text-4xl font-black outline-none w-16 md:w-32 lg:w-48 xl:w-64 ${isDarkMode ? 'text-white placeholder:text-slate-700' : 'text-slate-900 placeholder:text-slate-500'}`} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>S3. 設定</span>
              <div className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 p-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <div className={`flex p-0.5 rounded-md border h-full ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'}`}>
                  <button onClick={() => setTimeFormat('date')} className={`px-2 md:px-4 lg:px-6 xl:px-8 rounded-sm md:rounded-lg text-[10px] md:text-sm lg:text-base xl:text-lg font-black transition-all ${timeFormat === 'date' ? (isDarkMode ? 'bg-slate-700 text-white shadow-sm' : 'bg-slate-300 text-slate-900 shadow-sm') : 'text-slate-600 hover:text-slate-900'}`}>日期</button>
                  <button onClick={() => setTimeFormat('datetime')} className={`px-2 md:px-4 lg:px-6 xl:px-8 rounded-sm md:rounded-lg text-[10px] md:text-sm lg:text-base xl:text-lg font-black transition-all flex items-center gap-1.5 ${timeFormat === 'datetime' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}><Clock size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" />時間</button>
                </div>
                <button onClick={() => setLocationEnabled(!locationEnabled)} className={`h-full flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-md md:rounded-lg transition-all font-black text-[10px] md:text-sm lg:text-base xl:text-lg border ${locationEnabled ? 'bg-amber-600 border-amber-400 text-white' : (isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-600' : 'bg-slate-100 border-slate-300 text-slate-700')}`}><MapPin size={14} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" />儲位</button>
                
                {/* 擴充設定：作業編號與結尾碼 */}
                <div className={`h-full flex items-center gap-2 px-3 border-l ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-bold opacity-50">作業編號後綴</span>
                    <input 
                      value={workIdSuffix} 
                      onChange={(e) => setWorkIdSuffix(e.target.value)}
                      className={`w-16 md:w-24 text-[10px] md:text-sm font-black bg-transparent border-b border-dashed ${isDarkMode ? 'border-slate-700 text-blue-400' : 'border-slate-300 text-blue-600'}`}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-bold opacity-50">檔案結尾碼</span>
                    <input 
                      value={fileSuffix} 
                      onChange={(e) => setFileSuffix(e.target.value)}
                      className={`w-24 md:w-32 text-[10px] md:text-sm font-black bg-transparent border-b border-dashed ${isDarkMode ? 'border-slate-700 text-indigo-400' : 'border-slate-300 text-indigo-600'}`}
                    />
                  </div>
                </div>

                {/* 盤點日期顯示 (T-1) */}
                <div className={`h-full flex flex-col items-center justify-center px-2 md:px-4 border-l ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                  <span className={`text-[8px] md:text-[10px] font-bold uppercase opacity-50 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>盤點日期 (T-1)</span>
                  <span className={`text-[10px] md:text-lg font-black ${isDarkMode ? 'text-amber-500' : 'text-amber-600'}`}>
                    {(() => {
                      const d = getInventoryDate();
                      return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
                    })()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>除錯</span>
              <div className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 p-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <button onClick={handleExportLogs} title="匯出紀錄" className={`h-full flex items-center justify-center aspect-square rounded-md md:rounded-lg transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}>
                  <Bug size={16} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" />
                </button>
                <label title="TXT 格式修復轉檔" className={`h-full flex items-center justify-center aspect-square rounded-md md:rounded-lg transition-all border cursor-pointer ${isDarkMode ? 'bg-blue-900/20 border-blue-800 text-blue-400 hover:text-white' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'}`}>
                  <FileUp size={16} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" />
                  <input type="file" accept=".txt" onChange={handleRepairTxt} className="hidden" />
                </label>
                <button onClick={handleClearLogs} title="清除紀錄" className={`h-full flex items-center justify-center aspect-square rounded-md md:rounded-lg transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-red-400' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-red-500'}`}>
                  <RefreshCw size={16} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" />
                </button>
                <button onClick={handleClearAllData} title="重設所有資料" className={`h-full flex items-center justify-center aspect-square rounded-md md:rounded-lg transition-all border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-red-600' : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-red-600'}`}>
                  <X size={16} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={`text-[10px] md:text-xs lg:text-sm xl:text-base font-black uppercase tracking-tight pl-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>資訊</span>
              <div className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 p-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
                <button onClick={() => setShowUpdateModal(true)} className={`h-full flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-md md:rounded-lg transition-all font-black text-[10px] md:text-sm lg:text-base xl:text-lg border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}>
                  <Info size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" /> 更新
                </button>
                <button onClick={() => setShowGuideModal(true)} className={`h-full flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-md md:rounded-lg transition-all font-black text-[10px] md:text-sm lg:text-base xl:text-lg border ${isDarkMode ? 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'}`}>
                  <BookOpen size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" /> 教學
                </button>
                <button onClick={() => setShowDashboard(true)} className={`h-full flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-md md:rounded-lg transition-all font-black text-[10px] md:text-sm lg:text-base xl:text-lg border ${isDarkMode ? 'bg-blue-600/20 border-blue-500/30 text-blue-400 hover:bg-blue-600/30' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'}`}>
                  <LayoutDashboard size={14} className="md:w-5 md:h-5 lg:w-6 lg:h-6 xl:w-7 xl:h-7" /> 數據
                </button>
              </div>
            </div>

            <div className={`w-px mx-1.5 self-center h-10 md:h-16 lg:h-20 xl:h-24 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-300'}`} />

            <div className="flex flex-col gap-1">
              <span className="text-[10px] md:text-xs lg:text-sm xl:text-base font-black text-amber-500 uppercase tracking-tight pl-1">S4. 暫停</span>
              <button onClick={togglePause} disabled={data.length === 0} className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center justify-center px-3 md:px-8 lg:px-12 xl:px-16 rounded-lg text-sm md:text-2xl lg:text-3xl xl:text-4xl font-black transition-all shadow-sm border ${isPaused ? 'bg-amber-600 border-amber-400 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-amber-500 hover:bg-slate-800' : 'bg-white border-slate-300 text-amber-600 hover:bg-slate-100')} disabled:opacity-30`}>
                {isPaused ? <Play size={16} className="md:w-8 md:h-8 lg:w-10 lg:h-10 xl:w-12 xl:h-12" /> : <Pause size={16} className="md:w-8 md:h-8 lg:w-10 lg:h-10 xl:w-12 xl:h-12" />}
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] md:text-xs lg:text-sm xl:text-base font-black text-red-500 uppercase tracking-tight pl-1">S5. 結束</span>
              <div className="flex gap-1.5 md:gap-2 lg:gap-3">
                <button onClick={handleEndJob} disabled={data.length === 0} className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-lg text-xs md:text-xl lg:text-2xl xl:text-3xl font-black transition-all shadow-sm border ${data.length > 0 ? 'bg-red-600 border-red-400 hover:bg-red-700 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-white border-slate-300 text-slate-400 cursor-not-allowed')}`} title="匯出 Excel 並結束">
                  <LogOut size={14} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" /> 結束
                </button>
                <button onClick={handleExportMachineFormat} disabled={data.length === 0} className={`h-12 md:h-16 lg:h-20 xl:h-24 flex items-center gap-1.5 px-3 md:px-6 lg:px-8 xl:px-10 rounded-lg text-xs md:text-xl lg:text-2xl xl:text-3xl font-black transition-all shadow-sm border ${data.length > 0 ? 'bg-indigo-600 border-indigo-400 hover:bg-indigo-700 text-white' : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-700' : 'bg-white border-slate-300 text-slate-400 cursor-not-allowed')}`} title="匯出盤點機 TXT 格式">
                  <FileDown size={14} className="md:w-6 md:h-6 lg:w-8 lg:h-8 xl:w-10 xl:h-10" /> TXT
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex flex-col items-end text-right pb-1 shrink-0 ml-auto">
            <h1 className={`text-xs md:text-base lg:text-xl xl:text-2xl font-black tracking-tighter leading-none mb-1 md:mb-2 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>大豐資訊盤點系統</h1>
            <div className={`font-bold px-3 py-1 rounded-full text-[10px] lg:text-sm xl:text-base tracking-widest uppercase border ${isDarkMode ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>雲端備份就緒</div>
        </div>
        {/* 手機版標題簡化 */}
        <div className="md:hidden w-full flex justify-between items-center mt-1 px-1">
            <h1 className={`text-sm font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>大豐資訊盤點系統</h1>
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></div>
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
              className={`w-full bg-transparent pl-9 md:pl-16 lg:pl-24 pr-4 py-3 md:py-6 lg:py-12 text-2xl md:text-5xl lg:text-7xl font-black outline-none h-14 md:h-24 lg:h-auto ${isDarkMode ? 'text-white placeholder:text-slate-800' : 'text-slate-900 placeholder:text-slate-400'}`}
              autoComplete="off"
            />
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
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 lg:gap-8 xl:gap-8 min-h-0 mb-4 md:mb-4 lg:mb-6 xl:mb-6">
        {/* 上方/左方：產品資訊 */}
        <div className={`col-span-1 lg:col-span-8 border-2 md:border-3 lg:border-4 xl:border-[6px] rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col overflow-hidden relative shadow-2xl min-h-[300px] md:min-h-0 transition-all ${isDarkMode ? 'bg-slate-900/40 border-slate-800/50' : 'bg-white border-slate-200'}`}>
          {lastScanned ? (
            <div className="h-full flex flex-col">
              <div className={`flex-1 border-b-2 flex flex-col justify-center px-6 md:px-10 lg:px-16 xl:px-20 py-6 md:py-4 lg:py-0 ${isDarkMode ? 'border-slate-800/50 bg-slate-800/10' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`flex items-center gap-2 md:gap-3 lg:gap-4 xl:gap-6 mb-1 md:mb-2 lg:mb-4 font-black text-base md:text-lg lg:text-xl xl:text-3xl uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-700'}`}><Package size={18} className="md:w-6 md:h-6 lg:w-[28px] lg:h-[28px] xl:w-[48px] xl:h-[48px]" /> 商品名稱</div>
                <h2 className={`text-xl md:text-2xl lg:text-4xl xl:text-6xl font-black truncate drop-shadow-xl leading-tight whitespace-normal md:whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{lastScanned.name}</h2>
                <div className="flex gap-2 md:gap-4 lg:gap-6 mt-1 md:mt-2 lg:mt-4">
                  {lastScanned.color && <span className={`px-2 py-0.5 md:px-3 md:py-1 lg:px-4 lg:py-2 rounded-lg text-sm md:text-base lg:text-lg xl:text-2xl font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>顏色: {lastScanned.color}</span>}
                  {lastScanned.size && <span className={`px-2 py-0.5 md:px-3 md:py-1 lg:px-4 lg:py-2 rounded-lg text-sm md:text-base lg:text-lg xl:text-2xl font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>尺寸: {lastScanned.size}</span>}
                  {lastScanned.price && <span className={`px-2 py-0.5 md:px-3 md:py-1 lg:px-4 lg:py-2 rounded-lg text-sm md:text-base lg:text-lg xl:text-2xl font-bold ${isDarkMode ? 'bg-slate-800 text-amber-500' : 'bg-amber-100 text-amber-800'}`}>定價: ${lastScanned.price}</span>}
                </div>
              </div>
              <div className={`flex-1 border-b-2 flex flex-col justify-center px-6 md:px-10 lg:px-16 xl:px-20 py-6 md:py-4 lg:py-0 ${isDarkMode ? 'border-slate-800/50' : 'border-slate-200'}`}>
                <div className={`flex items-center gap-2 md:gap-3 lg:gap-4 xl:gap-6 mb-1 md:mb-2 lg:mb-4 font-black text-lg md:text-2xl lg:text-3xl xl:text-5xl uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-700'}`}><Info size={18} className="md:w-6 md:h-6 lg:w-[28px] lg:h-[28px] xl:w-[48px] xl:h-[48px]" /> 款式代號 / 條碼</div>
                <p className="text-2xl md:text-4xl lg:text-6xl xl:text-8xl font-black text-blue-400 font-mono tracking-tighter leading-none break-all">{lastScanned.productCode}</p>
                <p className={`text-lg md:text-2xl lg:text-4xl xl:text-6xl font-bold font-mono mt-2 md:mt-4 lg:mt-6 ${isDarkMode ? 'text-slate-600' : 'text-slate-800'}`}>{lastScanned.barcode}</p>
              </div>
            </div>
          ) : (
            <div className={`h-full flex flex-col items-center justify-center py-10 md:py-0 ${isDarkMode ? 'opacity-10' : 'opacity-30'}`}>
              <ScanBarcode size={80} className={`md:w-32 md:h-32 lg:w-[180px] lg:h-[180px] xl:w-[240px] xl:h-[240px] ${isDarkMode ? 'text-white' : 'text-slate-900'}`} />
              <p className={`text-xl md:text-3xl lg:text-5xl xl:text-7xl font-black mt-4 md:mt-8 lg:mt-12 tracking-[0.5em] uppercase text-center ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>掃描就緒</p>
            </div>
          )}
        </div>

        {/* 下方/右方：數量統計 */}
        <div className="col-span-1 lg:col-span-4 flex flex-row lg:flex-col gap-4 md:gap-6 lg:gap-8 xl:gap-10 h-32 md:h-40 lg:h-auto">
          <div className="flex-1 bg-blue-600 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col items-center justify-center shadow-2xl relative p-3 md:p-4 lg:p-6">
            <span className="text-blue-100 font-black text-base md:text-2xl lg:text-4xl xl:text-5xl mb-1 md:mb-2 lg:mb-4 xl:mb-6 uppercase tracking-[0.2em] md:tracking-[0.4em]">累計數量</span>
            <div className="text-4xl md:text-7xl lg:text-9xl xl:text-[12rem] font-black drop-shadow-2xl text-white leading-none">{lastScanned?.actualQty ?? '0'}</div>
            {lastScanned && (
              <button onClick={manualSetTotalQty} className={`absolute bottom-2 right-2 md:bottom-6 md:right-6 lg:bottom-10 lg:right-10 xl:bottom-14 xl:right-14 px-2 py-1 md:px-4 md:py-2 lg:px-6 lg:py-4 xl:px-8 xl:py-6 rounded-lg md:rounded-2xl lg:rounded-3xl transition-all flex items-center gap-1 md:gap-2 lg:gap-3 xl:gap-4 text-xs md:text-xl lg:text-2xl xl:text-4xl font-black backdrop-blur-md shadow-2xl border-2 ${isDarkMode ? 'bg-white/20 hover:bg-white text-white hover:text-blue-600 border-white/20' : 'bg-blue-700/20 hover:bg-blue-700 text-blue-700 hover:text-white border-blue-700/20'}`}><Edit3 size={14} className="md:w-6 md:h-6 lg:w-[32px] lg:h-[32px] xl:w-[48px] xl:h-[48px]" /> 修正</button>
            )}
          </div>
          <div className={`flex-1 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex flex-col items-center justify-center shadow-2xl transition-all duration-500 p-3 md:p-4 lg:p-6 ${!lastScanned ? (isDarkMode ? 'bg-slate-800 text-slate-700' : 'bg-slate-100 text-slate-600') : lastScanned.diff === 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
            <span className={`font-black text-base md:text-2xl lg:text-4xl xl:text-5xl mb-1 md:mb-2 lg:mb-4 xl:mb-6 uppercase tracking-[0.2em] md:tracking-[0.4em] ${!lastScanned ? (isDarkMode ? 'text-slate-700' : 'text-slate-400') : 'text-white opacity-80'}`}>庫存差異</span>
            <div className={`text-4xl md:text-7xl lg:text-9xl xl:text-[12rem] font-black leading-none ${!lastScanned ? (isDarkMode ? 'text-slate-700' : 'text-slate-400') : 'text-white'}`}>{lastScanned ? (lastScanned.diff > 0 ? `+${lastScanned.diff}` : lastScanned.diff) : '0'}</div>
          </div>
        </div>
      </main>

      {/* 底部數據：手機版改為 Grid 2欄，電腦版 3欄 */}
      <footer className="grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-8 lg:gap-12 xl:gap-12 shrink-0 h-auto md:h-40 lg:h-48 xl:h-56 2xl:h-64 mb-20 md:mb-4">
        <div className={`col-span-1 border-2 md:border-4 lg:border-[8px] rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center px-4 md:px-10 lg:px-16 xl:px-20 gap-3 md:gap-8 lg:gap-12 xl:gap-20 shadow-2xl py-4 md:py-0 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <Package className={`w-8 h-8 md:w-20 md:h-20 lg:w-28 lg:h-28 xl:w-36 xl:h-36 2xl:w-48 2xl:h-48 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`} />
          <div>
            <p className={`text-xs md:text-xl lg:text-2xl xl:text-4xl font-black uppercase mb-1 md:mb-2 lg:mb-4 xl:mb-6 tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>總項數</p>
            <p className={`text-2xl md:text-6xl lg:text-7xl xl:text-[10rem] 2xl:text-[12rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.length}</p>
          </div>
        </div>
        <div className={`col-span-1 border-2 md:border-4 lg:border-[8px] rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center px-4 md:px-10 lg:px-16 xl:px-20 gap-3 md:gap-8 lg:gap-12 xl:gap-20 shadow-2xl py-4 md:py-0 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <ClipboardCheck className={`w-8 h-8 md:w-20 md:h-20 lg:w-28 lg:h-28 xl:w-36 xl:h-36 2xl:w-48 2xl:h-48 ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`} />
          <div>
            <p className={`text-xs md:text-xl lg:text-2xl xl:text-4xl font-black uppercase mb-1 md:mb-2 lg:mb-4 xl:mb-6 tracking-widest ${isDarkMode ? 'text-emerald-600' : 'text-emerald-700'}`}>已完成</p>
            <p className={`text-2xl md:text-6xl lg:text-7xl xl:text-[10rem] 2xl:text-[12rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.filter(i => i.actualQty > 0).length}</p>
          </div>
        </div>
        <button onClick={() => setShowUnscannedList(true)} className={`col-span-2 lg:col-span-1 border-2 md:border-4 lg:border-[8px] hover:border-amber-500 rounded-2xl md:rounded-3xl lg:rounded-[4rem] flex items-center justify-center lg:justify-start px-4 md:px-10 lg:px-16 xl:px-20 gap-3 md:gap-8 lg:gap-12 xl:gap-20 transition-all group shadow-2xl py-4 md:py-0 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300 shadow-sm'}`}>
          <AlertCircle className="text-amber-500 group-hover:scale-110 transition-transform w-8 h-8 md:w-20 md:h-20 lg:w-28 lg:h-28 xl:w-36 xl:h-36 2xl:w-48 2xl:h-48" />
          <div className="text-left">
            <p className={`text-xs md:text-xl lg:text-2xl xl:text-4xl font-black uppercase mb-1 md:mb-2 lg:mb-4 xl:mb-6 tracking-widest ${isDarkMode ? 'text-amber-600' : 'text-amber-700'}`}>未盤項 (檢視)</p>
            <p className={`text-2xl md:text-6xl lg:text-7xl xl:text-[10rem] 2xl:text-[12rem] font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{data.filter(i => i.actualQty === 0 && i.bookQty > 0).length}</p>
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

      {/* 軟體更新 Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-4xl rounded-[2rem] md:rounded-[3rem] overflow-hidden shadow-2xl border-4 ${isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="p-8 md:p-14 bg-blue-600 text-white flex justify-between items-center">
              <div>
                <h3 className="text-3xl md:text-6xl font-black italic">軟體更新說明</h3>
                <p className="text-xl md:text-3xl opacity-80 font-bold mt-2">目前版本：{APP_VERSION}</p>
              </div>
              <button onClick={() => setShowUpdateModal(false)} className="p-3 hover:bg-white/20 rounded-full transition-colors"><X size={48} className="md:w-16 md:h-16" /></button>
            </div>
            <div className="p-10 md:p-20 space-y-8">
              <div className="space-y-6">
                {UPDATE_NOTES.map((note, idx) => (
                  <div key={idx} className="flex gap-6 items-start">
                    <div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-blue-500 mt-3 md:mt-4 shrink-0" />
                    <p className="text-xl md:text-4xl font-bold leading-relaxed">{note}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className={`p-8 md:p-14 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <button onClick={() => setShowUpdateModal(false)} className="w-full py-6 md:py-10 bg-slate-800 text-white rounded-3xl text-2xl md:text-4xl font-black hover:bg-slate-700 transition-all shadow-xl">確定</button>
            </div>
          </div>
        </div>
      )}

      {/* 使用教學 Modal */}
      {showGuideModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-6xl rounded-[2rem] md:rounded-[4rem] overflow-hidden shadow-2xl border-4 max-h-[92vh] flex flex-col ${isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="p-8 md:p-14 bg-emerald-600 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-6">
                <BookOpen size={48} className="md:w-20 md:h-20" />
                <h3 className="text-3xl md:text-6xl font-black italic">使用教學指南</h3>
              </div>
              <button onClick={() => setShowGuideModal(false)} className="p-3 hover:bg-white/20 rounded-full transition-colors"><X size={48} className="md:w-16 md:h-16" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-10 md:p-20 space-y-12 md:space-y-20 custom-scrollbar">
              {GUIDE_STEPS.map((step, idx) => (
                <div key={idx} className={`relative p-8 md:p-16 rounded-[2rem] md:rounded-[3rem] border-4 transition-all ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="absolute -top-8 -left-6 bg-emerald-600 text-white w-16 h-16 md:w-24 md:h-24 rounded-3xl flex items-center justify-center text-2xl md:text-5xl font-black shadow-2xl">{idx + 1}</div>
                  <h4 className="text-2xl md:text-5xl font-black mb-6 md:mb-10 pl-10 md:pl-16 text-emerald-500">{step.title}</h4>
                  <p className={`text-xl md:text-4xl font-bold leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{step.content}</p>
                </div>
              ))}
            </div>
            <div className={`p-8 md:p-14 border-t shrink-0 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <button onClick={() => setShowGuideModal(false)} className="w-full py-6 md:py-10 bg-emerald-600 text-white rounded-3xl text-2xl md:text-4xl font-black hover:bg-emerald-700 transition-all shadow-xl">我了解了，開始作業</button>
            </div>
          </div>
        </div>
      )}

      {/* 盤點數據儀表板 Modal */}
      {showDashboard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-7xl rounded-[2rem] md:rounded-[4rem] overflow-hidden shadow-2xl border-4 max-h-[92vh] flex flex-col ${isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className="p-6 md:p-10 bg-blue-600 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-6">
                <LayoutDashboard size={40} className="md:w-16 md:h-16" />
                <h3 className="text-2xl md:text-5xl font-black italic">盤點進度儀表板</h3>
              </div>
              <button onClick={() => setShowDashboard(false)} className="p-3 hover:bg-white/20 rounded-full transition-colors"><X size={40} className="md:w-12 md:h-12" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-8 md:space-y-12 custom-scrollbar">
              {/* 核心指標 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
                {[
                  { label: "總盤點進度", value: `${Math.round((data.filter(i => i.actualQty > 0).length / (data.length || 1)) * 100)}%`, icon: TrendingUp, color: "text-blue-500" },
                  { label: "庫存準確率", value: `${Math.round((data.filter(i => i.diff === 0 && i.actualQty > 0).length / (data.filter(i => i.actualQty > 0).length || 1)) * 100)}%`, icon: CheckCircle2, color: "text-emerald-500" },
                  { label: "總差異件數", value: data.reduce((acc, i) => acc + Math.abs(i.diff), 0), icon: AlertTriangle, color: "text-red-500" },
                  { label: "預估總價值", value: `$${Math.round(data.reduce((acc, i) => acc + (i.actualQty * (i.price || 0)), 0)).toLocaleString()}`, icon: DollarSign, color: "text-amber-500" }
                ].map((stat, idx) => (
                  <div key={idx} className={`p-6 md:p-10 rounded-3xl border-2 flex flex-col items-center justify-center text-center ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                    <stat.icon size={32} className={`mb-4 ${stat.color}`} />
                    <span className={`text-sm md:text-xl font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>{stat.label}</span>
                    <span className={`text-2xl md:text-5xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* 圖表區 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
                {/* 進度圓餅圖 */}
                <div className={`p-8 md:p-12 rounded-[2rem] md:rounded-[3rem] border-2 h-[400px] md:h-[500px] flex flex-col ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                  <h4 className="text-xl md:text-3xl font-black mb-8 flex items-center gap-3"><BarChart3 className="text-blue-500" /> 盤點狀態分佈</h4>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: '已盤點', value: data.filter(i => i.actualQty > 0).length },
                            { name: '未盤點', value: data.filter(i => i.actualQty === 0 && i.bookQty > 0).length },
                            { name: '新增項', value: data.filter(i => i.bookQty === 0 && i.actualQty > 0).length }
                          ]}
                          cx="50%" cy="50%"
                          innerRadius={60} outerRadius={120}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          <Cell fill="#3b82f6" />
                          <Cell fill="#64748b" />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}
                          itemStyle={{ color: isDarkMode ? '#fff' : '#000' }}
                        />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 差異最大的商品 */}
                <div className={`p-8 md:p-12 rounded-[2rem] md:rounded-[3rem] border-2 h-[400px] md:h-[500px] flex flex-col ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                  <h4 className="text-xl md:text-3xl font-black mb-8 flex items-center gap-3"><TrendingDown className="text-red-500" /> 庫存差異排行 (Top 5)</h4>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data
                          .filter(i => i.diff !== 0)
                          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
                          .slice(0, 5)
                          .map(i => ({ name: i.productCode, diff: i.diff }))
                        }
                        layout="vertical"
                        margin={{ left: 20, right: 30 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#1e293b' : '#e2e8f0'} />
                        <XAxis type="number" stroke={isDarkMode ? '#64748b' : '#94a3b8'} />
                        <YAxis dataKey="name" type="category" width={100} stroke={isDarkMode ? '#64748b' : '#94a3b8'} />
                        <Tooltip 
                          cursor={{ fill: isDarkMode ? '#1e293b' : '#f1f5f9' }}
                          contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}
                        />
                        <Bar dataKey="diff" radius={[0, 10, 10, 0]}>
                          {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.diff > 0 ? '#10b981' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* 異常清單摘要 */}
              <div className={`p-8 md:p-12 rounded-[2rem] md:rounded-[3rem] border-2 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                <h4 className="text-xl md:text-3xl font-black mb-8 flex items-center gap-3"><AlertCircle className="text-amber-500" /> 異常項目摘要</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-500 uppercase mb-2">盤盈項目</span>
                    <span className="text-2xl font-black text-emerald-500">{data.filter(i => i.diff > 0).length} 項</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-500 uppercase mb-2">盤虧項目</span>
                    <span className="text-2xl font-black text-red-500">{data.filter(i => i.diff < 0).length} 項</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-500 uppercase mb-2">未盤點總數</span>
                    <span className="text-2xl font-black text-slate-500">{data.filter(i => i.actualQty === 0 && i.bookQty > 0).length} 項</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className={`p-8 md:p-14 border-t shrink-0 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <button onClick={() => setShowDashboard(false)} className="w-full py-6 md:py-10 bg-blue-600 text-white rounded-3xl text-2xl md:text-4xl font-black hover:bg-blue-700 transition-all shadow-xl">返回作業</button>
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
            <div className="flex-1 overflow-hidden flex min-h-[300px] md:min-h-[400px]">
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
