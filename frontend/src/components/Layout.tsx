import { useState, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Avatar, Dropdown, theme, message, Modal } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  BellOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { getCurrentUserId } from '../lib/auth';
import { exportUserBackup, importUserBackup, isBackupFile } from '../lib/db';

const { Header, Sider, Content } = AntLayout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/invoices', icon: <FileTextOutlined />, label: '发票管理' },
  { key: '/suppliers', icon: <TeamOutlined />, label: '供应商管理' },
  { key: '/reminders', icon: <BellOutlined />, label: '到期提醒' },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: themeToken } = theme.useToken();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // ===== 导出 / 导入 JSON 备份 =====
  const handleExport = () => {
    const userId = getCurrentUserId();
    if (!userId) {
      messageApi.error('请先登录');
      return;
    }
    const backup = exportUserBackup(userId);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `yingfubao-备份-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    messageApi.success('已导出当前账号数据备份');
  };

  const handleImportClick = () => {
    const userId = getCurrentUserId();
    if (!userId) {
      messageApi.error('请先登录');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
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
    <AntLayout style={{ minHeight: '100vh' }}>
      {contextHolder}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        style={{ background: themeToken.colorBgContainer }}
      >
        <div style={{
          height: 48,
          margin: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: collapsed ? 16 : 20,
          color: themeToken.colorPrimary,
          cursor: 'pointer',
        }} onClick={() => navigate('/')}>
          {collapsed ? '💰' : '💰 应付宝'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname === '/' ? '/' : `/${location.pathname.split('/')[1]}`]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none' }}
        />
      </Sider>
      <AntLayout>
        <Header style={{
          background: themeToken.colorBgContainer,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出备份
            </Button>
            <Button icon={<UploadOutlined />} onClick={handleImportClick}>
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
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar icon={<UserOutlined />} />
                <span>{user.username || '用户'}</span>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: themeToken.colorBgContainer, borderRadius: 8, minHeight: 360 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
