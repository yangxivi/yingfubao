import { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Button, Avatar, Dropdown, theme, message, Modal, Drawer, Input, Typography, Alert, Space, Divider, Progress } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  UploadOutlined,
  TeamOutlined,
  BellOutlined,
  LogoutOutlined,
  UserOutlined,
  LockOutlined,
  DownloadOutlined,
  ImportOutlined,
  UpOutlined,
  MenuOutlined,
  FolderOpenOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { getCurrentUserId, clearSession, getAuthMode } from '../lib/auth';
import { exportUserBackup, importUserBackup, isBackupFile } from '../lib/db';
import { getCloudStatus } from '../lib/cloudStatus';
import { isDesktop, electronAPI, getBaiduOcrConfig, setBaiduOcrConfig, hasBaiduOcrConfig } from '../lib/desktop-env';
import { fetchSharedOcrQuota } from '../lib/ocr';
import { getOcrQuota, subscribeOcrQuota, isQuotaExhausted } from '../lib/ocr-quota';
import type { OcrQuota } from '../lib/ocr-quota';
import SetupWizard from './SetupWizard';
import UserProfileModal from './UserProfileModal';

const navItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/invoices', icon: <UploadOutlined />, label: '发票上传' },
  { key: '/invoice-list', icon: <FileTextOutlined />, label: '发票管理' },
  { key: '/suppliers', icon: <TeamOutlined />, label: '供应商管理' },
];

export default function Layout() {
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [baiduKey, setBaiduKey] = useState('');
  const [baiduSecret, setBaiduSecret] = useState('');
  const [showOcrHelp, setShowOcrHelp] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalTab, setUserModalTab] = useState<'username' | 'password'>('username');
  const [testingBaidu, setTestingBaidu] = useState(false);
  const isDesktopMode = isDesktop();
  const baiduConfigured = hasBaiduOcrConfig();
  const isOwnerUser = (user.username || '').toLowerCase() === 'xivi';
  const [quota, setQuota] = useState<OcrQuota | null>(
    getOcrQuota() ?? (!isOwnerUser ? { used: 0, total: 800 } : null),
  );
  const cloudStatus = getCloudStatus();
  const isLocal = !isDesktopMode && (getAuthMode() === 'local' || cloudStatus === 'uninitialized');

  // 订阅共享 OCR 额度（OCR 调用后会自动刷新）
  useEffect(() => {
    const unsubscribe = subscribeOcrQuota((q) => setQuota(q));
    let timer: ReturnType<typeof setInterval> | undefined;
    // 桌面端或网站端只要连了 Supabase 就主动查一次，并每 60 秒刷新
    if (!isLocal) {
      fetchSharedOcrQuota().catch(() => {});
      timer = setInterval(() => fetchSharedOcrQuota().catch(() => {}), 60_000);
    }
    return () => {
      unsubscribe();
      if (timer) clearInterval(timer);
    };
  }, [isLocal]);

  // 当前激活的 nav key
  const activeKey = (() => {
    const path = location.pathname;
    if (path === '/' || path === '') return '/';
    if (path.startsWith('/invoices') && !path.startsWith('/invoice-list')) return '/invoices';
    if (path.startsWith('/invoice-list')) return '/invoice-list';
    if (path.startsWith('/suppliers')) return '/suppliers';
    if (path.startsWith('/reminders')) return '/'; // 提醒页归入仪表盘
    return '/' + path.split('/')[1];
  })();

  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ===== 导出 / 导入 JSON 备份 =====
  const handleExport = () => {
    const userId = getCurrentUserId();
    if (!userId) { messageApi.error('请先登录'); return; }
    const backup = exportUserBackup(userId);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `yingfubao-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    messageApi.success('已导出当前账号数据备份');
  };

  const handleImportClick = () => {
    const userId = getCurrentUserId();
    if (!userId) { messageApi.error('请先登录'); return; }
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!isBackupFile(parsed)) {
          messageApi.error('文件格式不正确，不是有效的应付宝备份');
          return;
        }
        const supCount = parsed.data.suppliers.length;
        const invCount = parsed.data.invoices.length;
        Modal.confirm({
          title: '导入备份',
          content: `将用备份数据替换当前账号的 ${supCount} 条供应商、${invCount} 条发票记录。继续吗？`,
          okText: '导入并替换',
          cancelText: '取消',
          onOk: () => {
            const userId = getCurrentUserId();
            if (!userId) return;
            importUserBackup(userId, parsed);
            messageApi.success('导入成功，正在刷新…');
            setTimeout(() => window.location.reload(), 600);
          },
        });
      } catch {
        messageApi.error('解析失败：文件不是合法的 JSON');
      }
    };
    reader.onerror = () => messageApi.error('读取文件失败');
    reader.readAsText(file);
  };

  const openExternal = async (url: string) => {
    const api = electronAPI();
    if (api?.openExternal) {
      await api.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const openSettings = () => {
    const cfg = getBaiduOcrConfig();
    setBaiduKey(cfg?.apiKey || '');
    setBaiduSecret(cfg?.secretKey || '');
    setShowSettings(true);
  };

  const testBaidu = async () => {
    const key = baiduKey.trim();
    const secret = baiduSecret.trim();
    if (!key || !secret) {
      messageApi.error('请先填写百度 API Key 和 Secret Key');
      return false;
    }
    const api = electronAPI();
    if (!api?.baiduValidateKey) {
      messageApi.error('当前环境不支持验证');
      return false;
    }
    setTestingBaidu(true);
    try {
      await api.baiduValidateKey(key, secret);
      messageApi.success('百度 OCR Key 验证通过');
      return true;
    } catch (e: any) {
      const msg = e?.message || '验证失败';
      messageApi.error('百度 OCR Key 验证失败：' + msg);
      return false;
    } finally {
      setTestingBaidu(false);
    }
  };

  const saveBaidu = async () => {
    const key = baiduKey.trim();
    const secret = baiduSecret.trim();
    if (!key || !secret) {
      messageApi.error('百度 API Key 和 Secret Key 不能为空');
      return;
    }
    const ok = await testBaidu();
    if (!ok) return;
    setBaiduOcrConfig({ apiKey: key, secretKey: secret });
    messageApi.success('百度 OCR 配置已保存');
    setShowSettings(false);
  };

  const openUserModal = (tab: 'username' | 'password') => {
    setUserModalTab(tab);
    setShowUserModal(true);
  };

  const userMenu = {
    items: [
      ...(isDesktopMode
        ? [
            { key: 'editUsername', icon: <UserOutlined />, label: '修改用户名', onClick: () => openUserModal('username') },
            { key: 'changePassword', icon: <LockOutlined />, label: '修改密码', onClick: () => openUserModal('password') },
            { key: 'settings', icon: <SettingOutlined />, label: '设置', onClick: openSettings },
          ]
        : []),
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      {contextHolder}

      {/* 顶部导航栏 */}
      <header className="yb-navbar">
        <div className="yb-navbar-brand" onClick={() => navigate('/')}>
          <span className="brand-icon">📋</span>
          应付宝
        </div>

        <button
          className="yb-nav-toggle"
          onClick={() => setMobileNavOpen(true)}
          aria-label="打开导航菜单"
        >
          <MenuOutlined />
        </button>

        <nav className="yb-nav-links">
          {navItems.map((item) => (
            <div
              key={item.key}
              className={`yb-nav-link ${activeKey === item.key ? 'active' : ''}`}
              onClick={() => navigate(item.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {item.icon}
              {item.label}
            </div>
          ))}
        </nav>

        <div className="yb-navbar-right">
          {/* 云端同步状态标识 */}
          {isDesktopMode ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                padding: '2px 10px',
                borderRadius: 12,
                cursor: 'default',
                background: '#e6f4ff',
                color: '#1677ff',
                border: '1px solid #91caff',
                userSelect: 'none',
              }}
              title="数据保存在本机，离线可用"
            >
              💻 本地版
            </span>
          ) : (
            <span
              onClick={() => isLocal && setShowWizard(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                padding: '2px 10px',
                borderRadius: 12,
                cursor: isLocal ? 'pointer' : 'default',
                background: isLocal ? '#fff7e6' : '#f6ffed',
                color: isLocal ? '#fa8c16' : '#52c41a',
                border: `1px solid ${isLocal ? '#ffd591' : '#b7eb8f'}`,
                userSelect: 'none',
              }}
              title={isLocal ? '点击开启云端同步' : '云端同步已开启'}
            >
              {isLocal ? '💾 本地模式' : '☁️ 云端同步'}
            </span>
          )}

          {/* OCR 额度指示器：桌面端 / 网站端（已连 Supabase）始终显示。
              XIVI 账号 → 「自有 Key · 不限额度」；其它账号 → 「已调用 X / 800 次」（每月 1 日自动清零） */}
          {!isLocal && (
            <div
              className="yb-nav-hide-mobile"
              onClick={() => { if (isDesktopMode) openSettings(); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '2px 10px',
                borderRadius: 12,
                cursor: isDesktopMode ? 'pointer' : 'default',
                background: isOwnerUser ? '#e6f4ff' : isQuotaExhausted(quota) ? '#fff1f0' : '#f6ffed',
                color: isOwnerUser ? '#1677ff' : isQuotaExhausted(quota) ? '#cf1322' : '#389e0d',
                border: `1px solid ${isOwnerUser ? '#91caff' : isQuotaExhausted(quota) ? '#ffa39e' : '#b7eb8f'}`,
                userSelect: 'none',
                minWidth: 120,
              }}
              title={
                isOwnerUser
                  ? 'XIVI 账号：使用自有百度 OCR Key，不限额度，不占用共享 800 次'
                  : isQuotaExhausted(quota)
                    ? '共享额度已用完，点击配置自己的百度 Key'
                    : `共享百度 OCR 额度：本月已调用 ${quota?.used ?? 0} / ${quota?.total ?? 800} 次，每月 1 日自动清零重新统计`
              }
            >
              <ApiOutlined />
              <span>
                {isOwnerUser
                  ? '自有 Key · 不限额度'
                  : `已调用 ${quota?.used ?? 0} / ${quota?.total ?? 800} 次`}
              </span>
            </div>
          )}

          <Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleExport} className="yb-nav-hide-mobile">
            导出备份
          </Button>
          <Button type="text" size="small" icon={<ImportOutlined />} onClick={handleImportClick} className="yb-nav-hide-mobile">
            导入备份
          </Button>
          {isDesktopMode && (
            <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={() => electronAPI()?.openDataFolder()} className="yb-nav-hide-mobile">
              数据目录
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {user.avatar ? (
                <Avatar size={30} src={user.avatar} />
              ) : (
                <Avatar size={30} icon={<UserOutlined />} style={{ fontSize: 14, backgroundColor: '#1677ff' }} />
              )}
              <span style={{ fontSize: 13, color: '#666' }}>{user.username || '用户'}</span>
            </div>
          </Dropdown>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="yb-main-content" style={{ padding: '24px 32px 72px 32px', maxWidth: '1400px', margin: '0 auto' }}>
        <Outlet />
      </main>

      {/* 底部固定导航栏 */}
      <footer
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 48,
          background: '#fff',
          borderTop: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 32px',
          zIndex: 100,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ flex: 1 }} />
        <div className="footer-copyright" style={{ color: '#999', fontSize: 13 }}>COPYRIGHT @ 应付宝 - 应付账款管理系统</div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="text"
            icon={<UpOutlined />}
            onClick={scrollToTop}
            title="回到顶部"
            style={{ color: '#666' }}
          />
        </div>
      </footer>

      {/* 云���同步设置向导 */}
      <SetupWizard
        open={showWizard && !isDesktopMode}
        onClose={() => setShowWizard(false)}
        onSuccess={() => window.location.reload()}
      />

      {/* 移动端导航抽屉 */}
      <Drawer
        title="导航菜单"
        placement="left"
        width={240}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        bodyStyle={{ padding: 0 }}
      >
        {navItems.map((item) => (
          <div
            key={item.key}
            className={`yb-drawer-nav-item ${activeKey === item.key ? 'active' : ''}`}
            onClick={() => { setMobileNavOpen(false); navigate(item.key); }}
          >
            <span className="drawer-item-icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </Drawer>

      {/* 桌面端设置：百度 OCR 配置、检查更新、数据目录 */}
      <Modal
        title="桌面端设置"
        open={showSettings && isDesktopMode}
        onCancel={() => setShowSettings(false)}
        footer={null}
      >
        <Alert
          type={baiduConfigured ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 14 }}
          message={
            baiduConfigured
              ? '正在使用你自己的百度 OCR Key'
              : '正在使用应付宝共享百度 OCR Key'
          }
          description={
            baiduConfigured
              ? '发票识别走你自己的百度 Key，不限共享额度，Key 仅保存在本机。'
              : `所有用户共享每月 800 次免费调用额度。你可在下方填写自己的百度 Key，切换为独立额度。${quota && quota.total > 0 ? `本月已用 ${quota.used}/${quota.total} 次。` : ''}`
          }
        />

        <div style={{ margin: '8px 0 12px' }}>
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            style={{ paddingLeft: 0 }}
            onClick={() => openExternal('https://console.bce.baidu.com/ai/#/ai/ocr/overview/index')}
          >
            打开百度 OCR 控制台申请 Key
          </Button>
          <Button
            type="link"
            size="small"
            icon={<QuestionCircleOutlined />}
            style={{ paddingLeft: 0 }}
            onClick={() => setShowOcrHelp(true)}
          >
            如何申请？查看教程
          </Button>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>百度 API Key</div>
          <Input.Password placeholder="从百度智能云应用列表复制" value={baiduKey} onChange={(e) => setBaiduKey(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4 }}>百度 Secret Key</div>
          <Input.Password placeholder="从百度智能云应用列表复制" value={baiduSecret} onChange={(e) => setBaiduSecret(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" onClick={saveBaidu} loading={testingBaidu}>
            {testingBaidu ? '验证中…' : '保存并验证'}
          </Button>
          <Button onClick={() => electronAPI()?.checkUpdate()}>检查更新</Button>
          <Button onClick={() => electronAPI()?.openDataFolder()}>打开数据目录</Button>
        </div>
      </Modal>

      {/* OCR 方案说明 */}
      <Modal
        title="如何申请百度 OCR 免费 Key"
        open={showOcrHelp}
        onCancel={() => setShowOcrHelp(false)}
        footer={<Button type="primary" onClick={() => setShowOcrHelp(false)}>我知道了</Button>}
      >
        <Typography.Paragraph style={{ fontSize: 13 }}>
          <Typography.Text strong>1. 登录百度智能云</Typography.Text>
          <br />
          访问
          <Button type="link" size="small" style={{ padding: '0 4px' }} onClick={() => openExternal('https://console.bce.baidu.com/ai')}>
            百度智能云控制台
          </Button>
          ，用百度账号登录（没有就注册一个）。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ fontSize: 13 }}>
          <Typography.Text strong>2. 进入文字识别 OCR</Typography.Text>
          <br />
          点击「产品服务 → 人工智能 → 文字识别 OCR」，或直接打开
          <Button type="link" size="small" style={{ padding: '0 4px' }} onClick={() => openExternal('https://console.bce.baidu.com/ai/#/ai/ocr/overview/index')}>
            OCR 概览页
          </Button>
          。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ fontSize: 13 }}>
          <Typography.Text strong>3. 创建应用</Typography.Text>
          <br />
          点击「应用列表 → 创建应用」，填写应用名称（如「应付宝发票识别」），服务默认勾选「通用文字识别」。
        </Typography.Paragraph>
        <Typography.Paragraph style={{ fontSize: 13 }}>
          <Typography.Text strong>4. 复制 Key</Typography.Text>
          <br />
          创建完成后，在应用列表里复制 <Typography.Text code>API Key</Typography.Text> 和 <Typography.Text code>Secret Key</Typography.Text>，回到应付宝「设置」中粘贴保存。
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          icon={<CheckCircleOutlined />}
          message="额度说明"
          description="默认使用应付宝共享百度 Key，每月 800 次免费额度，满额后当月无法继续使用共享识别。如需无限制使用，请在「设置」中配置自己的百度 OCR Key。"
          style={{ marginTop: 12 }}
        />
      </Modal>

      {/* 桌面端：修改用户名 / 密码 */}
      {isDesktopMode && (
        <UserProfileModal
          open={showUserModal}
          tab={userModalTab}
          onClose={() => setShowUserModal(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
