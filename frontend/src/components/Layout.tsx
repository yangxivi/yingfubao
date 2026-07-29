import { useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Button, Avatar, Dropdown, theme, message, Modal, Drawer } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  UploadOutlined,
  TeamOutlined,
  BellOutlined,
  LogoutOutlined,
  UserOutlined,
  DownloadOutlined,
  ImportOutlined,
  UpOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { getCurrentUserId, clearSession, getAuthMode } from '../lib/auth';
import { exportUserBackup, importUserBackup, isBackupFile } from '../lib/db';
import { getCloudStatus } from '../lib/cloudStatus';
import SetupWizard from './SetupWizard';

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
  const cloudStatus = getCloudStatus();
  const isLocal = getAuthMode() === 'local' || cloudStatus === 'uninitialized';

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

  const userMenu = {
    items: [
      { key: 'user', label: user.username || '用户', disabled: true },
      { key: 'company', label: user.company_name || '未设置公司', disabled: true },
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

          <Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleExport} className="yb-nav-hide-mobile">
            导出备份
          </Button>
          <Button type="text" size="small" icon={<ImportOutlined />} onClick={handleImportClick} className="yb-nav-hide-mobile">
            导入备份
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Avatar size={30} icon={<UserOutlined />} style={{ fontSize: 14 }} />
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
        open={showWizard}
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
    </div>
  );
}
