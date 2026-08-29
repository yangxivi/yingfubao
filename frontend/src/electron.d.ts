// 桌面端（Electron）注入到 window 的 IPC 接口类型声明。
// 仅在 Electron 运行时存在；浏览器/网站端（window.electronAPI 为 undefined）下所有调用点都做了空值保护。

export interface ElectronAPI {
  /** 加载某用户全部数据（供应商/发票/用户）。发票 image_data 为空，图片以磁盘文件为准。 */
  dbLoad: (userId: string) => Promise<{
    users: any[];
    suppliers: any[];
    invoices: any[];
    seq: { users: number; suppliers: number; invoices: number };
  }>;
  /** 全量保存（upsert）供应商与发票；发票图片 base64 会被主进程落盘到 images/ 目录。 */
  dbSave: (payload: { suppliers: any[]; invoices: any[] }) => Promise<void>;
  /** 替换某用户全部供应商与发票（导入备份用）。 */
  dbReplace: (payload: { suppliers: any[]; invoices: any[] }) => Promise<void>;
  /** 桌面端：列出所有本地用户。 */
  userList: () => Promise<{ id: string; username: string; company_name: string; avatar: string; account_period: number; created_at: string }[]>;
  /** 桌面端：创建本地用户。 */
  userCreate: (payload: { username: string; password_hash: string; company_name?: string; account_period?: number; avatar?: string }) => Promise<{ id: string; username: string; company_name: string; avatar: string; account_period: number }>;
  /** 桌面端：验证用户名密码（主进程用 PBKDF2 比对，前端传明文即可）。 */
  userVerify: (payload: { username: string; password: string }) => Promise<{ id: string; username: string; company_name: string; avatar: string; account_period: number; hasPassword: boolean }>;
  /** 桌面端：更新用户名/公司名。 */
  userUpdate: (payload: { id: string; username?: string; company_name?: string }) => Promise<{ id: string; username: string; company_name: string }>;
  /** 桌面端：修改密码。 */
  userChangePassword: (payload: { id: string; password_hash: string }) => Promise<boolean>;
  /** 桌面端：删除用户及其数据。 */
  userDelete: (id: string) => Promise<boolean>;
  /** 更新用户的账期天数。 */
  updateUserPeriod: (id: string, period: number) => Promise<void>;
  /** 读取发票图片，返回 data URL（base64）。 */
  readImage: (id: string) => Promise<string>;
  /** 写入/覆盖发票图片（base64 data URL）。 */
  writeImage: (id: string, base64: string) => Promise<void>;
  /** 删除发票图片文件。 */
  deleteImage: (id: string) => Promise<void>;
  /** 主进程直连百度 OCR（用户自填 Key 时走此通道，规避 CORS）。返回识别出的纯文本。 */
  baiduOcr?: (imageB64: string, apiKey: string, secretKey: string) => Promise<string>;
  /** 仅验证百度 OCR Key 能否获取 access_token。 */
  baiduValidateKey?: (apiKey: string, secretKey: string) => Promise<boolean>;
  /** 打开数据目录（%APPDATA%/YingFuBao）。 */
  openDataFolder: () => Promise<void>;
  /** 用系统默认浏览器打开外部链接。 */
  openExternal?: (url: string) => Promise<void>;
  /** 返回应用版本号。 */
  getAppVersion: () => Promise<string>;
  /** 检查更新（electron-updater）。 */
  checkUpdate: () => Promise<void>;
  /** 共享 OCR：主进程代调 Supabase Edge Function（baidu-ocr），返回 { status, data }。 */
  ocrShared?: (body: any) => Promise<{ status: number; data: any }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
