import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

// 桌面端（Electron）使用 HashRouter：app:// 协议下 BrowserRouter 依赖 history API，
// 路径解析与打包产物中的绝对资源路径容易冲突导致白屏；HashRouter 更稳定。
const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI;
const Router = isDesktop ? HashRouter : BrowserRouter;

// 日期选择器面板月份改为数字（如 7月），避免显示英文缩写 Jul
const MONTHS_SHORT_CN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
dayjs.extend(updateLocale);
dayjs.updateLocale('zh-cn', {
  monthsShort: MONTHS_SHORT_CN,
});
dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{
      token: {
        colorPrimary: '#1677ff',
        borderRadius: 6,
      },
    }}>
      <Router basename={isDesktop ? undefined : (import.meta.env.VITE_BASE_URL || '/')}>
        <App />
      </Router>
    </ConfigProvider>
  </React.StrictMode>
);
