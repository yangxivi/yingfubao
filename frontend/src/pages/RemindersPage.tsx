import { useState, useEffect } from 'react';
import { Table, Tag, Card, Empty, Image, Button } from 'antd';
import {
  AlertOutlined, ClockCircleOutlined, WarningOutlined,
  CalendarOutlined, ExclamationCircleOutlined,
  FileTextOutlined, EyeOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '../api/client';
import dayjs from 'dayjs';

type TabKey = 'overdue' | '15' | '30' | '60' | '90';

export default function RemindersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overdue');

  useEffect(() => {
    dashboardApi.reminders().then((res) => {
      setData(res.data);
    }).finally(() => setLoading(false));
  }, []);

  const getDaysLeft = (paymentDate: string) => {
    if (!paymentDate) return null;
    const today = dayjs();
    const target = dayjs(paymentDate);
    return target.diff(today, 'day');
  };

  const getStatusTag = (days: number | null) => {
    if (days === null) return <Tag>未知</Tag>;
    if (days < 0) return <Tag color="red">已逾期 {Math.abs(days)} 天</Tag>;
    if (days <= 15) return <Tag color="volcano">{days} 天内到期</Tag>;
    if (days <= 30) return <Tag color="orange">{days} 天内到期</Tag>;
    if (days <= 60) return <Tag color="gold">{days} 天内到期</Tag>;
    if (days <= 90) return <Tag color="blue">{days} 天内到期</Tag>;
    return <Tag>{days} 天后到期</Tag>;
  };

  // Tab 筛选
  const tabs: { key: TabKey; label: string; count: number; danger?: boolean }[] = [
    { key: 'overdue', label: '已逾期', count: data?.overdue || 0, danger: true },
    { key: '15', label: '15天内', count: data?.due_within_15 || 0 },
    { key: '30', label: '30天内', count: data?.due_within_30 || 0 },
    { key: '60', label: '60天内', count: data?.due_within_60 || 0 },
    { key: '90', label: '90天内', count: data?.due_within_90 || 0 },
  ];

  const getFilteredInvoices = () => {
    if (!data?.invoices) return [];
    const today = dayjs();
    return data.invoices.filter((inv: any) => {
      if (!inv.payment_date) return false;
      const daysLeft = dayjs(inv.payment_date).diff(today, 'day');
      switch (activeTab) {
        case 'overdue': return daysLeft < 0;
        case '15': return daysLeft >= 0 && daysLeft <= 15;
        case '30': return daysLeft > 15 && daysLeft <= 30;
        case '60': return daysLeft > 30 && daysLeft <= 60;
        case '90': return daysLeft > 60 && daysLeft <= 90;
        default: return false;
      }
    });
  };

  const filteredInvoices = getFilteredInvoices();

  if (!data) return null;

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>到期提醒</h2>
        <p>按时间查看各待期内的发票</p>
      </div>

      <Card>
        {/* Tab 切换 */}
        <div className="yb-tab-bar" style={{ marginBottom: 20 }}>
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={`yb-tab ${tab.danger ? 'tab-danger' : ''} ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.danger ? <ExclamationCircleOutlined /> : <ClockCircleOutlined />}
              {tab.label}
              <span className="tab-count">({tab.count})</span>
            </div>
          ))}
        </div>

        {/* 发票列表 */}
        {filteredInvoices.length > 0 ? (
          <div>
            {filteredInvoices.map((inv: any) => {
              const dl = getDaysLeft(inv.payment_date);
              return (
                <div key={inv.id} className="yb-invoice-row">
                  <div className="yb-invoice-thumb">📄</div>
                  <div className="yb-invoice-info">
                    <div className="yb-invoice-no">
                      <FileTextOutlined style={{ marginRight: 6, color: '#1677ff', fontSize: 13 }} />
                      {inv.invoice_no}
                    </div>
                    <div className="yb-invoice-supplier">{inv.supplier_name}</div>
                    <div className="yb-invoice-meta">
                      付款日期 {inv.payment_date || '-'}
                      {dl !== null && (
                        <span style={{
                          marginLeft: 12,
                          color: dl < 0 ? '#ff4d4f' : dl <= 7 ? '#fa8c16' : '#999',
                        }}>
                          剩余 {Math.abs(dl)} 天
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="yb-invoice-right">
                    <div className="yb-invoice-amount" style={{ color: '#1677ff' }}>
                      ¥{inv.total_amount?.toLocaleString()}
                    </div>
                    <div className="yb-invoice-status">{getStatusTag(dl)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty description={`暂无${tabs.find(t => t.key === activeTab)?.label || ''}发票`} style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>
    </div>
  );
}
