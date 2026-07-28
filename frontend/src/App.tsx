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
import { getCurrentUserId } from './lib/auth';
import { initUserDB } from './lib/db';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [ready, setReady] = useState(false);

  // 刷新/重进时：已登录则预热云端缓存，确保页面读取到最新数据
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userId = getCurrentUserId();
    if (!token || !userId) {
      setReady(true);
      return;
    }
    initUserDB(userId)
      .catch((e) => console.warn('初始化云端数据失败', e))
      .finally(() => setReady(true));
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
      </Route>
    </Routes>
  );
}
