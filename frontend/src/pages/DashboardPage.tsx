import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Statistic, Tag, Spin, Alert, Image, Empty, Button,
} from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CalendarOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '../api/client';
import dayjs from 'dayjs';

type TabKey = 'overdue' | '15' | '30' | '60' | '90';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [reminders, setReminders] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overdue');

  useEffect(() => {
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.reminders(),
    ]).then(([summaryRes, remindersRes]) => {
      setData(summaryRes.data);
      setReminders(remindersRes.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <Alert type="error" message="加载失败" />;

  // 计算各状态数量
  const paidCount = data.total_invoices - data.pending_count;
  const overdueCount = data.overdue_count;
  const pendingCount = data.pending_count - overdueCount;

  // Tab 筛选发票
  const getFilteredInvoices = () => {
    if (!reminders?.invoices) return [];
    const today = dayjs();
    return reminders.invoices.filter((inv: any) => {
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

  // Tab 配置
  const tabs: { key: TabKey; label: string; count: number; danger?: boolean }[] = [
    { key: 'overdue', label: '已逾期', count: reminders?.overdue || 0, danger: true },
    { key: '15', label: '15天内', count: reminders?.due_within_15 || 0 },
    { key: '30', label: '30天内', count: reminders?.due_within_30 || 0 },
    { key: '60', label: '60天内', count: reminders?.due_within_60 || 0 },
    { key: '90', label: '90天内', count: reminders?.due_within_90 || 0 },
  ];

  const getStatusTag = (paymentDate: string) => {
    if (!paymentDate) return <Tag>未知</Tag>;
    const days = dayjs(paymentDate).diff(dayjs(), 'day');
    if (days < 0) return <Tag color="red">已逾期</Tag>;
    if (days <= 15) return <Tag color="volcano">即将到期</Tag>;
    return <Tag color="blue">{days}天后到期</Tag>;
  };

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>仪表盘</h2>
        <p>发票管理系统总览</p>
      </div>

      {/* 第一行：4个统计卡片 */}
      <div className="yb-stat-grid">
        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">总发票数</div>
            <div className="stat-value">{data.total_invoices}</div>
            <div className="stat-sub">系统中总的发票总数</div>
          </div>
          <div className="stat-icon" style={{ background: '#e6f4ff', color: '#1677ff' }}>
            <FileTextOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">供应商数量</div>
            <div className="stat-value">{data.supplier_count}</div>
            <div className="stat-sub">合作供应商总数</div>
          </div>
          <div className="stat-icon" style={{ background: '#e6f4ff', color: '#1677ff' }}>
            <TeamOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">总金额</div>
            <div className="stat-value">¥{data.total_payable.toLocaleString()}</div>
            <div className="stat-sub">所有待付金额总和</div>
          </div>
          <div className="stat-icon" style={{ background: '#fff7e6', color: '#fa8c16' }}>
            <DollarOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">待处理</div>
            <div className="stat-value" style={{ color: '#faad14' }}>{pendingCount + overdueCount}</div>
            <div className="stat-sub">待付款发票数量</div>
          </div>
          <div className="stat-icon" style={{ background: '#fffbe6', color: '#faad14' }}>
            <ClockCircleOutlined />
          </div>
        </div>
      </div>

      {/* 第二行：状态统计 */}
      <div className="yb-stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="yb-stat-card stat-success">
          <div className="stat-main">
            <div className="stat-label">已付款</div>
            <div className="stat-value">{paidCount}</div>
            <div className="stat-sub">已结清付款的发票</div>
          </div>
          <div className="stat-icon"><CheckCircleOutlined /></div>
        </div>

        <div className="yb-stat-card stat-warning">
          <div className="stat-main">
            <div className="stat-label">待付款</div>
            <div className="stat-value">{pendingCount}</div>
            <div className="stat-sub">等待付款的发票</div>
          </div>
          <div className="stat-icon"><ClockCircleOutlined /></div>
        </div>

        <div className="yb-stat-card stat-danger">
          <div className="stat-main">
            <div className="stat-label">已逾期</div>
            <div className="stat-value">{overdueCount}</div>
            <div className="stat-sub">超过付款期限的发票</div>
          </div>
          <div className="stat-icon"><WarningOutlined /></div>
        </div>
      </div>

      {/* 到期发票提醒 */}
      <Card style={{ marginTop: 20 }}>
        <div className="yb-card-title">
          <WarningOutlined style={{ color: '#faad14' }} />
          到期发票提醒
        </div>
        <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>按时间查看各待期内的发票</p>

        {/* Tab 切换 */}
        <div className="yb-tab-bar">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={`yb-tab ${tab.danger ? 'tab-danger' : ''} ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.danger ? <ExclamationCircleOutlined /> : <CalendarOutlined />}
              {tab.label}
              <span className="tab-count">({tab.count})</span>
            </div>
          ))}
        </div>

        {/* 发票列表 */}
        {filteredInvoices.length > 0 ? (
          <div>
            {filteredInvoices.map((inv: any) => {
              const daysLeft = inv.payment_date ? dayjs(inv.payment_date).diff(dayjs(), 'day') : null;
              return (
                <div key={inv.id} className="yb-invoice-row" onClick={() => navigate(`/invoice-list?id=${inv.id}`)}>
                  <div className="yb-invoice-thumb">
                    📄
                  </div>
                  <div className="yb-invoice-info">
                    <div className="yb-invoice-no">{inv.invoice_no}</div>
                    <div className="yb-invoice-supplier">{inv.supplier_name}</div>
                    <div className="yb-invoice-meta">
                      付款日期 {inv.payment_date || '-'}
                      {daysLeft !== null && (
                        <span style={{
                          marginLeft: 12,
                          color: daysLeft < 0 ? '#ff4d4f' : daysLeft <= 7 ? '#fa8c16' : '#999',
                        }}>
                          剩余 {Math.abs(daysLeft)} 天
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="yb-invoice-right">
                    <div className="yb-invoice-amount" style={{ color: '#1677ff' }}>
                      ¥{inv.total_amount?.toLocaleString()}
                    </div>
                    <div className="yb-invoice-status">{getStatusTag(inv.payment_date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty description="暂无到期发票" style={{ padding: '40px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Card>
    </div>
  );
}
