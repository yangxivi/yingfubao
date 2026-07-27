import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Avatar, Dropdown, theme } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  BellOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = AntLayout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/invoices', icon: <FileTextOutlined />, label: '发票管理' },
  { key: '/suppliers', icon: <TeamOutlined />, label: '供应商管理' },
  { key: '/reminders', icon: <BellOutlined />, label: '到期提醒' },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token: themeToken } = theme.useToken();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
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
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user.username || '用户'}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: themeToken.colorBgContainer, borderRadius: 8, minHeight: 360 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
