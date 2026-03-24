
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  FileDown, CheckCircle2, Search,
  ScanBarcode, FileSpreadsheet, X,
  Link, Info, Package, ClipboardCheck, AlertCircle, PlusCircle, MapPin, Clock, User,
  Pause, Play, LogOut, Edit3, Hash, CloudSync, CloudCheck, CloudOff, Menu,
  RefreshCw, AlertTriangle, Terminal, Bug,
  Sun, Moon, BookOpen, ChevronRight, LayoutDashboard, TrendingUp, TrendingDown, DollarSign, BarChart3,
  Settings, Diff, Layers, Circle, Scan, FileText
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
    content: "在「人員/倉庫」欄位輸入您的姓名與目前作業的倉庫代碼，並在「貨架」欄位輸入目前盤點的貨架編號。這些資訊將包含在最終匯出的報表中。"
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
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isClassicMode, setIsClassicMode] = useState(false);

  const [operatorName, setOperatorName] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('T0300');
  const [workIdSuffix, setWorkIdSuffix] = useState('FT015');
  const [fileSuffix, setFileSuffix] = useState('0 00000021');
  const [shelfEnabled, setShelfEnabled] = useState(true);
  const [currentShelf, setCurrentShelf] = useState('00');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('date');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pauseInput, setPauseInput] = useState('');

  // Refs to avoid stale closures
  const dataRef = useRef(data);
  const configRef = useRef({ scanQty, shelfEnabled, currentShelf, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode, isClassicMode });

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    configRef.current = { scanQty, shelfEnabled, currentShelf, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode, isClassicMode };
  }, [scanQty, shelfEnabled, currentShelf, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode, isClassicMode]);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLInputElement>(null);

  const totalActual = data.reduce((sum, item) => sum + item.actualQty, 0);
  const totalDiff = data.reduce((sum, item) => sum + item.diff, 0);

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
          setShelfEnabled(!!parsed.config.shelfEnabled);
          setCurrentShelf(parsed.config.currentShelf || '');
          setTimeFormat(parsed.config.timeFormat === 'off' ? 'date' : (parsed.config.timeFormat || 'date'));
          setOperatorName(parsed.config.operatorName || '');
          setWarehouseCode(parsed.config.warehouseCode || 'T0300');
          setIsPaused(!!parsed.config.isPaused);
          if (parsed.config.isDarkMode !== undefined) setIsDarkMode(parsed.config.isDarkMode);
          if (parsed.config.isClassicMode !== undefined) setIsClassicMode(parsed.config.isClassicMode);
        }
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (data.length > 0 || operatorName || warehouseCode !== 'T0300' || shelfEnabled || timeFormat !== 'off' || isPaused || !isDarkMode || isClassicMode) {
      const config = { shelfEnabled, currentShelf, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode, isClassicMode };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: data, config }));
    }
  }, [data, shelfEnabled, currentShelf, timeFormat, operatorName, warehouseCode, isPaused, isDarkMode, isClassicMode]);

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

  const togglePause = useCallback(() => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    if (nextPaused && data.length > 0) {
      backupToCloud(data);
    } else {
      setSyncStatus('idle');
    }
    audioService.playFeedback(nextPaused ? 'mapping' : 'success');
  }, [isPaused, data, backupToCloud]);

  useEffect(() => {
    if (!isPaused) {
      setPauseInput('');
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        setPauseInput(prev => {
          const next = (prev + e.key).slice(-4);
          if (next === '0000') {
            togglePause();
            return '';
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaused, togglePause]);

  const ClassicScannerView = () => {
    const invDate = getInventoryDate();
    const yyyymmdd = invDate.getFullYear().toString() + 
                     (invDate.getMonth() + 1).toString().padStart(2, '0') + 
                     invDate.getDate().toString().padStart(2, '0');

    return (
      <div className="flex-1 bg-[#E8E8F0] text-black font-mono flex flex-col items-center justify-center p-4 overflow-hidden select-none">
        <div className="w-full max-w-md border-4 border-black bg-white shadow-2xl flex flex-col h-[90vh]">
          {/* Header */}
          <div className="flex justify-between items-center px-4 py-2 border-b-2 border-black bg-white">
            <span className="text-2xl font-bold">盤點作業－比對</span>
            <span className="text-2xl font-bold bg-black text-white px-2">累加</span>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 space-y-4 text-3xl">
            <div className="flex">
              <span className="w-24">日期</span>
              <span className="flex-1 text-red-600">[{yyyymmdd}]</span>
            </div>
            <div className="flex">
              <span className="w-24">倉庫</span>
              <span className="flex-1 text-red-600">[{warehouseCode.padEnd(10, ' ')}]</span>
            </div>
            <div className="flex">
              <span className="w-24">人員</span>
              <span className="flex-1 text-red-600">[{operatorName.padEnd(10, ' ')}]</span>
            </div>
            <div className="flex">
              <span className="w-24">貨架</span>
              <span className="flex-1 text-red-600">[{currentShelf.padEnd(10, ' ')}]</span>
            </div>
            <div className="flex items-center">
              <span className="w-24">條碼</span>
              <div className="flex-1 px-2 py-1 flex items-center relative min-h-[3rem]">
                <span className="text-black">[</span>
                <div className="flex-1 flex items-center">
                  <span className="break-all text-red-600">{inputValue}</span>
                  <div className="w-5 h-8 bg-red-600 ml-1 animate-pulse" />
                </div>
                <input 
                  autoFocus
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan(e as any)}
                  className="absolute inset-0 opacity-0 cursor-none"
                />
                <span className="text-black">]</span>
              </div>
            </div>

            <div className="pt-12 space-y-2">
              <p>本次輸入量：{scanQty}</p>
              <p>本商品數量：<span className="text-blue-700">{lastScanned?.actualQty || 0}</span></p>
              <p>本日本倉總數：<span className="text-blue-700">{totalActual}</span></p>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-white text-black flex justify-between px-2 py-3 text-2xl border-t-2 border-black">
            <button 
              onClick={togglePause}
              className="flex items-center gap-1 hover:bg-gray-100 px-1 rounded transition-colors active:scale-95"
            >
              <span className="bg-black text-white px-1 font-bold">M2</span>
              <span className="text-red-600">MODE</span>
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1 hover:bg-gray-100 px-1 rounded transition-colors active:scale-95"
            >
              <span className="bg-black text-white px-1 font-bold">F1</span>
              <span className="text-red-600">主選單</span>
            </button>
            <button 
              onClick={() => setIsClassicMode(false)}
              className="flex items-center gap-1 hover:bg-gray-100 px-1 rounded transition-colors active:scale-95"
            >
              <span className="bg-black text-white px-1 font-bold">F4</span>
              <span className="text-red-600">返回</span>
            </button>
          </div>
          
          {/* Bottom Branding & Battery */}
          <div className="bg-white py-2 px-4 flex justify-between items-center border-t border-gray-200">
            {/* Battery Indicator (Bottom Left) */}
            <div className="flex items-center gap-1">
              <div className="w-1 h-2 bg-blue-600 rounded-l-sm" />
              <div className="w-10 h-5 border-2 border-blue-600 rounded-sm p-0.5 flex gap-0.5">
                <div className="flex-1 bg-transparent h-full" />
                <div className="flex-1 bg-blue-600 h-full" />
                <div className="flex-1 bg-blue-600 h-full" />
              </div>
            </div>
            
            <span className="italic font-black text-2xl tracking-widest text-black">DENSO</span>
            <div className="w-10" /> {/* Spacer */}
          </div>
        </div>
      </div>
    );
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
    const { isPaused, scanQty, shelfEnabled, currentShelf, timeFormat, operatorName } = configRef.current;
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

      if (shelfEnabled && currentShelf.trim()) item.shelf = currentShelf.trim();
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
      shelf: (shelfEnabled && currentShelf.trim()) ? currentShelf.trim() : undefined,
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
      '盤點數量': i.actualQty,
      '盤點差異': i.diff,
      '作業員': i.operator || '',
      '貨架': i.shelf || '',
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
    
    // Helper to pad strings to fixed width and FORCE exact length
    const pad = (str: string, length: number) => {
      const s = (str || '').toString();
      return s.padEnd(length, ' ').slice(0, length);
    };

    const lines = data
      .filter(item => item.actualQty > 0)
      .map(item => {
        const col1 = pad(warehouseCode, 15);
        const col2 = pad(workId, 20);
        const col3 = pad(item.shelf || currentShelf || '00', 12);
        const col4 = pad(item.barcode || item.productCode, 32);
        const col5 = pad(item.actualQty.toString(), 56);
        const col6 = pad(suffix, 10);
        
        return `${col1}${col2}${col3}${col4}${col5}${col6}`;
      });

    // 結合行，但最後一行絕對不加換行符號 (防止 ERP 讀取空行崩潰)
    const content = lines.join('\r\n');
    
    // Use TextEncoder to ensure clean output without BOM
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(content);
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dafeng_inv_${yyyymmdd}.TXT`;
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

  return (
    // Root: macOS Style Layout
    <div className={`flex flex-col select-none relative h-screen overflow-hidden transition-colors duration-500 ${isDarkMode ? 'bg-[#1E1E1E] text-[#E1E1E1]' : 'bg-[#F2F2F7] text-[#1D1D1F]'}`}>
      
      {isPaused ? (
        <div 
          onClick={togglePause}
          className={`fixed inset-0 z-[200] backdrop-blur-xl flex flex-col items-center justify-center cursor-pointer animate-in fade-in duration-500 ${isDarkMode ? 'bg-black/40' : 'bg-white/40'}`}
        >
          <div 
            className="bg-amber-500 p-10 rounded-full shadow-2xl hover:scale-105 transition-transform mb-8 group"
          >
            <Play size={56} className="text-white" fill="currentColor" />
          </div>
          
          <div className="text-center space-y-4">
            <h2 className="text-5xl font-bold tracking-tight">盤點已暫停</h2>
            <div className="space-y-2 opacity-70">
              <p className="text-xl font-medium">點擊任何地方繼續作業</p>
              <p className="text-lg text-amber-500 font-bold">提示：請輸入 4 個 0 (0000) 回到主畫面</p>
            </div>
          </div>

          <div className="mt-12 flex gap-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleExportMachineFormat();
              }}
              className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg transition-all shadow-lg hover:scale-105 active:scale-95 ${
                isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white hover:bg-gray-50 text-slate-900'
              }`}
            >
              <FileText size={24} className="text-amber-500" />
              匯出目前 TXT 檔
            </button>
          </div>
        </div>
      ) : isClassicMode ? (
        <ClassicScannerView />
      ) : (
        <>

      {/* macOS Toolbar */}
      <header className={`h-[52px] px-4 flex items-center justify-between shrink-0 border-b backdrop-blur-md z-50 ${isDarkMode ? 'bg-[#2D2D2D]/80 border-black/20' : 'bg-white/80 border-black/5'}`}>
        <div className="flex items-center gap-1">
          <div className={`p-1.5 rounded-md mr-2 ${isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-500 text-white'}`}>
            <Package size={16} />
          </div>
          <div className="flex flex-col leading-tight mr-6">
            <h1 className="text-[13px] font-bold">大豐資訊盤點</h1>
            <p className="text-[10px] opacity-50 font-medium">系統版本 {APP_VERSION}</p>
          </div>

          <div className="flex items-center gap-0.5">
            <label className={`h-8 flex items-center gap-2 px-3 rounded-md cursor-pointer text-[14px] font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-700'}`}>
              <FileSpreadsheet size={15} /> 匯入資料
              <input type="file" accept=".csv, .xlsx" onChange={(e) => {
                 const file = e.target.files?.[0]; if (!file) return;
                  const r = new FileReader();
                  r.onload = (ev) => {
                    const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                    setData((json as any[]).map(row => {
                      const barcode = String(row['國際條碼'] || row['條碼編號'] || row['條碼'] || '').trim();
                      const productCode = String(row['款式代號'] || row['產品代號'] || row['品號'] || '').trim();
                      const name = String(row['商品名稱'] || row['品名'] || row['名稱'] || '').trim();
                      const bookQty = parseFloat(row['合計'] || row['期末數量'] || row['數量'] || row['庫存'] || 0);
                      return {
                        barcode, productCode, name,
                        price: parseFloat(row['含稅定價'] || row['定價'] || 0),
                        color: String(row['顏色'] || '').trim(),
                        size: String(row['尺寸'] || '').trim(),
                        bookQty, actualQty: 0, diff: -bookQty,
                        originalRow: row
                      };
                    }));
                    addLog('info', '成功匯入庫存資料', { itemCount: json.length });
                  };
                  r.readAsArrayBuffer(file);
               }} className="hidden" />
            </label>

            <button onClick={() => setShowSettings(true)} className={`h-8 flex items-center gap-2 px-3 rounded-md transition-colors text-[14px] font-medium ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-700'}`}>
              <Settings size={15} /> 設定
            </button>

            <button onClick={() => setShowGuideModal(true)} className={`h-8 flex items-center gap-2 px-3 rounded-md transition-colors text-[14px] font-medium ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-700'}`}>
              <BookOpen size={15} /> 使用教學
            </button>

            <button onClick={() => { setUnknownBarcode(''); setNewProductName(''); setNewProductCode(''); setIsCreatingNew(true); setShowMappingModal(true); }} className={`h-8 flex items-center gap-2 px-3 rounded-md transition-colors text-[14px] font-medium ${isDarkMode ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-black/5 text-slate-700'}`}>
              <PlusCircle size={15} /> 新增商品
            </button>

            <div className={`w-px h-4 mx-2 ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />

            <button onClick={handleEndJob} disabled={data.length === 0} className={`h-8 flex items-center gap-2 px-3 rounded-md transition-colors text-[14px] font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-30`}>
              <LogOut size={15} /> 結束作業
            </button>

            <button onClick={handleExportMachineFormat} disabled={data.length === 0} className={`h-8 flex items-center gap-2 px-3 rounded-md transition-colors text-[14px] font-medium text-blue-500 hover:bg-blue-500/10 disabled:opacity-30`}>
              <FileDown size={15} /> 匯出 TXT
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${syncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' : syncStatus === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
            <span className="text-[11px] font-medium opacity-50 uppercase tracking-wider">{syncStatus === 'syncing' ? 'Syncing' : 'Ready'}</span>
          </div>
          <button onClick={togglePause} className={`p-2 rounded-md transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        </div>
      </header>
            <main className="flex-1 overflow-hidden flex flex-col p-6 gap-6">
        {/* macOS Dashboard Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
          {[
            { label: '累計數量', value: totalActual, icon: <Hash size={15} />, color: 'text-blue-500' },
            { label: '庫存差異', value: totalDiff, icon: <Diff size={15} />, color: totalDiff === 0 ? 'text-slate-500' : totalDiff > 0 ? 'text-emerald-500' : 'text-red-500' },
            { label: '總項數', value: data.length, icon: <Layers size={15} />, color: 'text-slate-500' },
            { label: '已完成', value: data.filter(i => i.actualQty > 0).length, icon: <CheckCircle2 size={15} />, color: 'text-emerald-500' },
            { label: '未盤項', value: data.filter(i => i.actualQty === 0 && i.bookQty > 0).length, icon: <Circle size={15} />, color: 'text-amber-500' },
          ].map((card, i) => (
            <div key={i} className={`p-4 rounded-xl shadow-sm border flex flex-col gap-1 transition-all hover:shadow-md ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <div className="flex items-center gap-2 opacity-40 text-[12px] font-bold uppercase tracking-wider">
                {card.icon} {card.label}
              </div>
              <div className={`text-[24px] font-bold tracking-tight ${card.color}`}>
                {card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* macOS Search-style Input Bar */}
        <div className="flex flex-col items-center gap-4 shrink-0">
          <form onSubmit={handleScan} className={`flex items-center w-full max-w-2xl h-14 rounded-xl border shadow-sm overflow-hidden transition-all focus-within:ring-2 focus-within:ring-blue-500/50 ${isDarkMode ? 'bg-[#2D2D2D] border-white/10' : 'bg-white border-black/10'}`}>
            <div className={`flex items-center gap-2 px-5 border-r h-full ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-black/5 bg-black/5'}`}>
              <span className="text-[13px] font-bold opacity-40 uppercase">Qty</span>
              <input
                ref={qtyRef}
                type="text"
                value={scanQty}
                onChange={(e) => setScanQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    inputRef.current?.focus(); 
                  }
                }}
                className="w-14 bg-transparent text-center font-bold text-[20px] outline-none"
                placeholder="1"
              />
            </div>
            <div className="flex-1 flex items-center px-5 gap-3">
              <Search size={20} className="opacity-30 text-blue-500" />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isPaused ? "暫停中..." : "掃描條碼或輸入編號..."}
                disabled={data.length === 0 || isPaused}
                className="flex-1 bg-transparent outline-none text-[17px] font-medium placeholder:opacity-30"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="h-full px-8 bg-blue-500 text-white font-bold text-[15px] hover:bg-blue-600 transition-colors">
              確認
            </button>
          </form>

          {/* 最後掃描商品資訊 (Product Info Area) */}
          <div className={`w-full max-w-2xl p-6 rounded-xl border shadow-sm flex items-center gap-6 transition-all duration-300 ${lastScanned ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'} ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
            <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-3">
              <div className="col-span-2 mb-1">
                <span className="text-[12px] font-bold opacity-40 uppercase tracking-wider block mb-0.5">最後掃描商品</span>
                <h2 className="text-[20px] font-bold truncate">{lastScanned?.name || '未命名商品'}</h2>
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-bold opacity-40 uppercase tracking-wider">款式代號</span>
                <span className="text-[15px] font-medium">{lastScanned?.productCode || '-'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-bold opacity-40 uppercase tracking-wider">國際條碼</span>
                <span className="text-[15px] font-medium">{lastScanned?.barcode || '-'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-bold opacity-40 uppercase tracking-wider">顏色 / 尺寸</span>
                <span className="text-[15px] font-medium">{lastScanned?.color || '-'} / {lastScanned?.size || '-'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-bold opacity-40 uppercase tracking-wider">含稅定價</span>
                <span className="text-[15px] font-bold text-blue-500">${lastScanned?.price?.toLocaleString() || '0'}</span>
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-center justify-center p-5 bg-blue-500/10 rounded-lg border border-blue-500/20 min-w-[100px]">
              <span className="text-[12px] font-bold text-blue-500 uppercase tracking-wider mb-1">實盤數量</span>
              <span className="text-4xl font-bold text-blue-500">{lastScanned?.actualQty || 0}</span>
            </div>
          </div>
        </div>

        {/* Real-time Data Table Area */}
        <div className={`flex-1 rounded-2xl border shadow-sm overflow-hidden flex flex-col ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
          <div className={`h-12 px-6 flex items-center border-b text-[13px] font-bold uppercase tracking-wider opacity-50 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
            <div className="w-16">序號</div>
            <div className="flex-1">條碼 / 商品名稱</div>
            <div className="w-24 text-center">實盤</div>
            <div className="w-24 text-center">帳面</div>
            <div className="w-24 text-center">差異</div>
            <div className="w-24 text-right">狀態</div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {data.filter(i => i.actualQty > 0 || i.barcode === lastScanned?.barcode).sort((a, b) => (b.scanTime || 0) - (a.scanTime || 0)).map((item, idx) => (
              <div key={item.barcode} className={`px-6 py-5 flex items-center border-b last:border-0 transition-colors hover:bg-black/5 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
                <div className="w-16 text-[14px] opacity-40 font-mono">{data.length - idx}</div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="text-[16px] font-bold tracking-tight">{item.barcode}</div>
                  <div className="text-[14px] opacity-50 font-medium truncate max-w-md">{item.name || '未命名商品'}</div>
                </div>
                <div className="w-24 text-center text-[18px] font-bold text-blue-500">{item.actualQty}</div>
                <div className="w-24 text-center text-[15px] opacity-50">{item.bookQty}</div>
                <div className={`w-24 text-center text-[15px] font-bold ${item.diff === 0 ? 'opacity-30' : item.diff > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {item.diff > 0 ? `+${item.diff}` : item.diff}
                </div>
                <div className="w-24 text-right">
                  <span className={`text-[12px] font-bold px-3 py-1 rounded-full uppercase tracking-tighter ${item.diff === 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    {item.diff === 0 ? 'Match' : 'Diff'}
                  </span>
                </div>
              </div>
            ))}
            {data.filter(i => i.actualQty > 0).length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                <Scan size={64} strokeWidth={1} />
                <p className="text-xl font-medium">尚未開始盤點，請掃描條碼</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Unscanned List Modal */}
      {showUnscannedList && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className={`rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl border overflow-hidden ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-[#F2F2F7] border-black/10 text-slate-900'}`}>
            <div className={`p-5 border-b flex justify-between items-center shrink-0 ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="text-amber-500" />
                <h3 className="text-[17px] font-bold">未清點項目清單</h3>
              </div>
              <button 
                onClick={() => setShowUnscannedList(false)}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
              >
                <X size={20} className="opacity-60" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
              {data.filter(i => i.bookQty > 0 && i.actualQty === 0).length === 0 ? (
                <div className="text-center py-20 opacity-40">
                  <CheckCircle2 size={56} className="mx-auto mb-4 text-emerald-500/50" />
                  <p className="text-[15px] font-medium">所有應盤項目皆已清點！</p>
                </div>
              ) : (
                data.filter(i => i.bookQty > 0 && i.actualQty === 0).map((item, idx) => (
                  <div key={idx} className={`p-5 rounded-xl border transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/5 hover:border-white/20' : 'bg-white border-black/5 hover:border-black/10 shadow-sm'}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-bold truncate mb-1">{item.name}</p>
                        <p className="text-[13px] font-mono opacity-50 truncate">{item.productCode} • {item.barcode}</p>
                        <div className="flex gap-2 mt-3">
                          {item.color && <span className={`text-[12px] px-3 py-1 rounded-md font-medium ${isDarkMode ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>{item.color}</span>}
                          {item.size && <span className={`text-[12px] px-3 py-1 rounded-md font-medium ${isDarkMode ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>{item.size}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[12px] font-bold uppercase tracking-wider opacity-40 mb-1">應有</p>
                        <p className="text-[22px] font-bold text-amber-500">{item.bookQty}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className={`p-5 border-t flex justify-between items-center shrink-0 ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <p className="text-[12px] font-medium opacity-50">
                共 {data.filter(i => i.bookQty > 0 && i.actualQty === 0).length} 項未清點
              </p>
              <button 
                onClick={() => setShowUnscannedList(false)}
                className="px-6 py-2 rounded-lg bg-blue-500 text-white font-bold text-[13px] hover:bg-blue-600 transition-all shadow-sm"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 軟體更新 Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border flex flex-col ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-[#F2F2F7] border-black/10 text-slate-900'}`}>
            <div className={`p-8 flex flex-col items-center text-center gap-4 ${isDarkMode ? 'bg-[#2D2D2D]' : 'bg-white'}`}>
              <div className="w-16 h-16 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Info size={32} className="text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold">軟體更新說明</h3>
                <p className="text-[13px] opacity-50 font-medium mt-1">目前版本：{APP_VERSION}</p>
              </div>
            </div>
            <div className="p-8 space-y-4 overflow-y-auto max-h-[50vh] custom-scrollbar">
              {UPDATE_NOTES.map((note, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                  <p className="text-[14px] font-medium leading-relaxed opacity-80">{note}</p>
                </div>
              ))}
            </div>
            <div className={`p-6 border-t flex justify-center ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <button 
                onClick={() => setShowUpdateModal(false)}
                className="px-12 py-2.5 rounded-lg bg-blue-500 text-white font-bold text-[14px] hover:bg-blue-600 transition-all shadow-sm"
              >
                了解並關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 使用教學 Modal */}
      {showGuideModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border flex flex-col max-h-[90vh] ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-[#F2F2F7] border-black/10 text-slate-900'}`}>
            <div className={`p-6 flex justify-between items-center shrink-0 border-b ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <div className="flex items-center gap-3">
                <BookOpen size={20} className="text-emerald-500" />
                <h3 className="text-lg font-bold">使用教學指南</h3>
              </div>
              <button onClick={() => setShowGuideModal(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
              {GUIDE_STEPS.map((step, idx) => (
                <div key={idx} className={`p-8 rounded-xl border transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500 text-white flex items-center justify-center text-[16px] font-bold shadow-lg shadow-emerald-500/20">{idx + 1}</div>
                    <h4 className="text-[18px] font-bold text-emerald-500">{step.title}</h4>
                  </div>
                  <p className="text-[16px] font-medium leading-relaxed opacity-70">{step.content}</p>
                </div>
              ))}
            </div>
            <div className={`p-6 border-t flex justify-center shrink-0 ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <button 
                onClick={() => setShowGuideModal(false)}
                className="px-16 py-3.5 rounded-lg bg-emerald-500 text-white font-bold text-[16px] hover:bg-emerald-600 transition-all shadow-sm"
              >
                我了解了，開始作業
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 盤點數據儀表板 Modal */}
      {showDashboard && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl border flex flex-col max-h-[90vh] ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-[#F2F2F7] border-black/10 text-slate-900'}`}>
            <div className={`p-6 flex justify-between items-center shrink-0 border-b ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <div className="flex items-center gap-3">
                <LayoutDashboard size={20} className="text-blue-500" />
                <h3 className="text-lg font-bold">盤點數據儀表板</h3>
              </div>
              <button onClick={() => setShowDashboard(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={20} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              {/* 核心指標 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "總盤點進度", value: `${Math.round((data.filter(i => i.actualQty > 0).length / (data.length || 1)) * 100)}%`, icon: TrendingUp, color: "text-blue-500" },
                  { label: "庫存準確率", value: `${Math.round((data.filter(i => i.diff === 0 && i.actualQty > 0).length / (data.filter(i => i.actualQty > 0).length || 1)) * 100)}%`, icon: CheckCircle2, color: "text-emerald-500" },
                  { label: "總差異件數", value: data.reduce((acc, i) => acc + Math.abs(i.diff), 0), icon: AlertTriangle, color: "text-red-500" },
                  { label: "預估總價值", value: `$${Math.round(data.reduce((acc, i) => acc + (i.actualQty * (i.price || 0)), 0)).toLocaleString()}`, icon: DollarSign, color: "text-amber-500" }
                ].map((stat, idx) => (
                  <div key={idx} className={`p-6 rounded-xl border flex flex-col items-center justify-center text-center shadow-sm ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
                    <stat.icon size={20} className={`mb-3 ${stat.color}`} />
                    <span className="text-[11px] font-bold uppercase tracking-wider opacity-50 mb-1">{stat.label}</span>
                    <span className="text-2xl font-bold tracking-tight">{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* 圖表區 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 進度圓餅圖 */}
                <div className={`p-6 rounded-xl border h-[350px] flex flex-col shadow-sm ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
                  <h4 className="text-[13px] font-bold mb-6 flex items-center gap-2 opacity-50 uppercase tracking-wider"><BarChart3 size={14} className="text-blue-500" /> 盤點狀態分佈</h4>
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
                          innerRadius={50} outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          <Cell fill="#3b82f6" />
                          <Cell fill={isDarkMode ? '#475569' : '#94a3b8'} />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: isDarkMode ? '#2D2D2D' : '#fff', border: 'none', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 差異最大的商品 */}
                <div className={`p-6 rounded-xl border h-[350px] flex flex-col shadow-sm ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
                  <h4 className="text-[13px] font-bold mb-6 flex items-center gap-2 opacity-50 uppercase tracking-wider"><TrendingDown size={14} className="text-red-500" /> 庫存差異排行 (Top 5)</h4>
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
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={80} axisLine={false} tickLine={false} style={{ fontSize: '11px', fontWeight: 'bold', opacity: 0.5 }} />
                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                        <Bar dataKey="diff" radius={[0, 4, 4, 0]} barSize={20}>
                          {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.diff > 0 ? '#10b981' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* 異常摘要 */}
              <div className={`p-6 rounded-xl border ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5 shadow-sm'}`}>
                <h4 className="text-[13px] font-bold mb-6 opacity-50 uppercase tracking-wider">異常項目摘要</h4>
                <div className="grid grid-cols-3 gap-8">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold opacity-40 uppercase">盤盈項目</span>
                    <p className="text-xl font-bold text-emerald-500">{data.filter(i => i.diff > 0).length} <span className="text-xs opacity-50">項</span></p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold opacity-40 uppercase">盤虧項目</span>
                    <p className="text-xl font-bold text-red-500">{data.filter(i => i.diff < 0).length} <span className="text-xs opacity-50">項</span></p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold opacity-40 uppercase">未盤點</span>
                    <p className="text-xl font-bold opacity-50">{data.filter(i => i.actualQty === 0 && i.bookQty > 0).length} <span className="text-xs opacity-50">項</span></p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className={`p-6 border-t flex justify-end ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <button 
                onClick={() => setShowDashboard(false)}
                className="px-10 py-2.5 rounded-lg bg-blue-500 text-white font-bold text-[14px] hover:bg-blue-600 transition-all shadow-sm"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
                      <div className={`p-4 md:p-8 rounded-2xl md:rounded-3xl shadow-inner border-2 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-200 border-slate-400'}`}>
                        <label className="block text-sm md:text-xl font-black text-slate-500 mb-1 md:mb-2 uppercase">條碼</label>
                        {isCreatingNew ? (
                          <input 
                            type="text" 
                            value={unknownBarcode} 
                            onChange={(e) => setUnknownBarcode(e.target.value)}
                            placeholder="輸入條碼..."
                            className={`w-full bg-transparent text-xl md:text-4xl font-black outline-none ${isDarkMode ? 'text-white placeholder:text-slate-800' : 'text-slate-900 placeholder:text-slate-400'}`}
                          />
                        ) : (
                          <p className={`text-xl md:text-4xl font-black break-all ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{unknownBarcode}</p>
                        )}
                      </div>
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
                        if (shelfEnabled && currentShelf.trim()) updated[dIdx].shelf = currentShelf.trim();
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
      {/* 系統設定 Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className={`w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border flex flex-col ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 text-white' : 'bg-[#F2F2F7] border-black/10 text-slate-900'}`}>
            <div className={`p-6 flex justify-between items-center shrink-0 border-b ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-[#2D2D3A] text-white border-black/5'}`}>
              <div className="flex items-center gap-3">
                <Settings size={22} className="text-white" />
                <h3 className="text-[18px] font-bold">系統設定</h3>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[14px] font-bold opacity-60 ml-1">盤點人員</label>
                  <input 
                    type="text" 
                    value={operatorName} 
                    onChange={(e) => setOperatorName(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/10' : 'bg-white border-black/10'}`}
                    placeholder="輸入姓名..."
                  />
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="text-[14px] font-bold uppercase tracking-wider opacity-60 ml-1">倉庫代號</label>
                  <input 
                    type="text" 
                    value={warehouseCode} 
                    onChange={(e) => setWarehouseCode(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/10' : 'bg-white border-black/10'}`}
                    placeholder="例如: T0301"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[14px] font-bold uppercase tracking-wider opacity-60 ml-1">貨架編號</label>
                  <input 
                    type="text" 
                    value={currentShelf} 
                    onChange={(e) => setCurrentShelf(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/10' : 'bg-white border-black/10'}`}
                    placeholder="例如: 00"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[14px] font-bold uppercase tracking-wider opacity-60 ml-1">工單後綴 (TXT)</label>
                  <input 
                    type="text" 
                    value={workIdSuffix} 
                    onChange={(e) => setWorkIdSuffix(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${isDarkMode ? 'bg-[#2D2D2D] border-white/10' : 'bg-white border-black/10'}`}
                    placeholder="例如: FT015"
                  />
                </div>
              </div>

              <div className="h-px bg-black/10 dark:bg-white/10 my-2" />

              <div className="pt-2 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[15px] font-bold">經典模式</span>
                    <span className="text-[12px] opacity-50">復刻實體盤點機介面</span>
                  </div>
                  <button 
                    onClick={() => setIsClassicMode(!isClassicMode)}
                    className={`w-14 h-7 rounded-full relative transition-colors ${isClassicMode ? 'bg-blue-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${isClassicMode ? 'left-8' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[15px] font-bold">深色模式</span>
                    <span className="text-[12px] opacity-50">切換介面配色方案</span>
                  </div>
                  <button 
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className={`w-14 h-7 rounded-full relative transition-colors ${isDarkMode ? 'bg-blue-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${isDarkMode ? 'left-8' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[15px] font-bold">貨架追蹤</span>
                    <span className="text-[12px] opacity-50">啟用貨架位置輸入功能</span>
                  </div>
                  <button 
                    onClick={() => setShelfEnabled(!shelfEnabled)}
                    className={`w-14 h-7 rounded-full relative transition-colors ${shelfEnabled ? 'bg-blue-500' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${shelfEnabled ? 'left-8' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            <div className={`p-6 border-t flex justify-end gap-3 ${isDarkMode ? 'bg-[#2D2D2D] border-white/5' : 'bg-white border-black/5'}`}>
              <button 
                onClick={() => setShowSettings(false)}
                className={`w-full py-4 rounded-xl font-bold text-[16px] transition-all bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-600/20`}
              >
                儲存並關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
