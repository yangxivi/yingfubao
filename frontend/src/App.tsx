import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InvoiceListPage from './pages/InvoiceListPage';
import SupplierListPage from './pages/SupplierListPage';
import RemindersPage from './pages/RemindersPage';
import UploadPage from './pages/UploadPage';
import { getCurrentUserId, detectAndLockAuthMode, syncCurrentUserToCloud } from './lib/auth';
import { initUserDB } from './lib/db';
import { initAccountPeriodFromSession } from './lib/accountPeriod';
import { setCloudStatus } from './lib/cloudStatus';
import SettingsPage from './pages/SettingsPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [ready, setReady] = useState(false);

  // 刷新/重进时：探测云端状态 → 预热数据
  useEffect(() => {
    const init = async () => {
      // 1. 探测 Supabase 状态并锁定鉴权模式
      const status = await detectAndLockAuthMode();
      setCloudStatus(status);
      setReady(true); // 触发一次重渲染

      // 2. 恢复账期设置
      initAccountPeriodFromSession();

      // 3. 已登录则预热数据缓存
      const token = localStorage.getItem('token');
      const userId = getCurrentUserId();
      if (token && userId) {
        // 云端就绪时，先把本地账号同步到云端 users 表，否则发票外键会失败
        if (status === 'ready') {
          try {
            await syncCurrentUserToCloud();
          } catch (e) {
            console.warn('同步账号到云端失败', e);
          }
        }
        try {
          await initUserDB(userId);
        } catch (e) {
          console.warn('初始化数据失败', e);
        }
      }
    };
    init();
  }, []);

  if (!ready) {
    return <Spin size="large" style={{ display: 'block', margin: '160px auto' }} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="invoices" element={<UploadPage />} />
        <Route path="invoice-list" element={<InvoiceListPage />} />
        <Route path="suppliers" element={<SupplierListPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
