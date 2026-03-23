
export interface LogEntry {
  timestamp: string;
  type: 'info' | 'error' | 'scan' | 'system';
  message: string;
  details?: any;
}

export interface InventoryItem {
  barcode: string;      // 條碼編號 (國際條碼)
  productCode: string;  // 產品代號 (款式代號)
  name: string;         // 品名 (商品名稱)
  price?: number;       // 含稅定價
  color?: string;       // 顏色
  size?: string;        // 尺寸
  bookQty: number;      // 期末數量 (合計)
  actualQty: number;    // 盤點數量
  diff: number;         // 差異數
  location?: string;    // 儲位資訊
  scanTime?: string;    // 掃描日期時間
  operator?: string;    // 作業員
  originalRow?: any;    // 原始 Excel 完整列資料
  mappedBarcodes?: string[]; // 記錄額外關聯到此項目的錯誤條碼
  remarks?: string;     // 額外備註
}

export interface ScanResult {
  success: boolean;
  message: string;
  item?: InventoryItem;
}

export interface AISearchResult {
  text: string;
  sources: { title: string; uri: string }[];
}
