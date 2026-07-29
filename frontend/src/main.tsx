import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

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
      <BrowserRouter basename={import.meta.env.VITE_BASE_URL || '/'}>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
