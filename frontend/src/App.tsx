import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { Suspense, lazy } from 'react';
import Layout from './components/Layout'; // 外壳保留静态导入，首屏立即可见
import { getCurrentUserId, detectAndLockAuthMode, syncCurrentUserToCloud, setAuthMode } from './lib/auth';
import { initUserDB } from './lib/db';
import { initAccountPeriodFromSession } from './lib/accountPeriod';
import { setCloudStatus } from './lib/cloudStatus';

// 页面按需懒加载，避免首屏打包全部页面（含仪表盘图表、上传、OCR 逻辑）
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const InvoiceListPage = lazy(() => import('./pages/InvoiceListPage'));
const SupplierListPage = lazy(() => import('./pages/SupplierListPage'));
const RemindersPage = lazy(() => import('./pages/RemindersPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLoading() {
  return (
    <div className="yb-app-loading">
      <Spin size="large" />
      <p className="yb-app-loading-text">数据正在加载中</p>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  // 启动各异步步骤加超时兜底，避免任意网络调用挂起导致永久 spinner
  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T | null> => {
    return Promise.race([
      p,
      new Promise<T | null>((resolve) =>
        setTimeout(() => {
          console.warn(`[init] ${label} 超时(${ms}ms)，跳过以免永久卡在加载页`);
          resolve(null);
        }, ms),
      ),
    ]);
  };

  // 刷新/重进时：探测云端状态 → 预热数据 → 再渲染页面
  useEffect(() => {
    const init = async () => {
      // 1. 探测 Supabase 状态并锁定鉴权模式（超时则保守降级本地模式）
      const status = await withTimeout(detectAndLockAuthMode(), 8000, '探测云端');
      setCloudStatus(status ?? 'uninitialized');
      if (status === null) setAuthMode('local');

      // 2. 恢复账期设置
      initAccountPeriodFromSession();

      // 3. 已登录则预热数据缓存（必须在渲染页面前完成，否则仪表盘首次全 0）
      const token = localStorage.getItem('token');
      const userId = getCurrentUserId();
      if (token && userId) {
        if ((status ?? 'uninitialized') === 'ready') {
          await withTimeout(syncCurrentUserToCloud(), 8000, '同步账号');
        }
        await withTimeout(initUserDB(userId), 15000, '预热数据');
      }

      // 4. 数据就绪后才允许渲染（解决仪表盘首次加载竞态问题）
      setReady(true);
    };
    init();
  }, []);

  if (!ready) {
    return <AppLoading />;
  }

  return (
    <Suspense fallback={<AppLoading />}>
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
    </Suspense>
  );
}
