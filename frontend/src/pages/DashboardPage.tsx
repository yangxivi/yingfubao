import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Statistic, Tag, Spin, Alert, Image, Empty, Button,
  Row, Col, Progress, Tooltip, Modal, InputNumber, Space, message,
} from 'antd';
import {
  FileTextOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CalendarOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  PieChartOutlined,
  WalletOutlined,
  DollarOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { dashboardApi, authApi, invoiceApi } from '../api/client';
import { getAccountPeriod } from '../lib/accountPeriod';
import dayjs from 'dayjs';

// 驾驶舱图表配色
const STATUS_COLOR: Record<string, string> = {
  paid: '#52c41a',
  pending: '#faad14',
  overdue: '#ff4d4f',
};
const SUPPLIER_COLORS = ['#1677ff', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96'];
const CHART_BLUE = '#1677ff';
const CHART_RED = '#ff4d4f';

// 金额格式化
function fmtMoney(v: number): string {
  const rounded = Math.round((v || 0) * 100) / 100;
  return '¥' + rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000000) return (v / 100000000).toFixed(1) + '亿';
  if (a >= 10000) return (v / 10000).toFixed(1) + '万';
  return Math.round(v).toString();
}

// 生成月度趋势的面积/折线 path（viewBox 坐标系）
function buildTrendPaths(data: { amount: number }[]) {
  const w = 640;
  const h = 240;
  const padX = 36;
  const padY = 24;
  const max = Math.max(1, ...data.map((d) => d.amount));
  const stepX = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: padX + stepX * i,
    y: h - padY - (d.amount / max) * (h - padY * 2),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x},${h - padY} L${pts[0].x},${h - padY} Z`;
  return { line, area, pts, w, h, padX, padY };
}

type TabKey = 'overdue' | '30' | '60' | '90' | '120' | '150' | '180';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [reminders, setReminders] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [allInvoices, setAllInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overdue');
  const [messageApi, contextHolder] = message.useMessage();

  // 账期设置弹窗
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [periodValue, setPeriodValue] = useState<number>(getAccountPeriod());
  const [savingPeriod, setSavingPeriod] = useState(false);

  const openPeriodModal = () => {
    setPeriodValue(getAccountPeriod());
    setPeriodModalOpen(true);
  };

  const handleSavePeriod = async () => {
    if (!periodValue || periodValue < 1) {
      messageApi.error('账期天数必须大于 0');
      return;
    }
    setSavingPeriod(true);
    try {
      await authApi.updateAccountPeriod(periodValue);
      const res = await invoiceApi.recomputePaymentDates();
      messageApi.success(
        `账期已更新为 ${periodValue} 天，已同步更新 ${res.data?.updated ?? 0} 张发票的付款日期与状态`,
      );
      setPeriodModalOpen(false);
      // 刷新仪表盘数据
      setLoading(true);
      Promise.all([
        dashboardApi.summary(),
        dashboardApi.reminders(),
        dashboardApi.analytics(),
        invoiceApi.list(),
      ]).then(([summaryRes, remindersRes, analyticsRes, allRes]) => {
        setData(summaryRes.data);
        setReminders(remindersRes.data);
        setAnalytics(analyticsRes.data);
        setAllInvoices(allRes.data);
      }).finally(() => setLoading(false));
    } catch (err: any) {
      messageApi.error(err?.response?.data?.detail || '保存失败');
    } finally {
      setSavingPeriod(false);
    }
  };

  useEffect(() => {
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.reminders(),
      dashboardApi.analytics(),
      invoiceApi.list(),
    ]).then(([summaryRes, remindersRes, analyticsRes, allRes]) => {
      setData(summaryRes.data);
      setReminders(remindersRes.data);
      setAnalytics(analyticsRes.data);
      setAllInvoices(allRes.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <Alert type="error" message="加载失败" />;

  // 计算各状态数量
  const paidCount = data.total_invoices - data.pending_count;
  const overdueCount = data.overdue_count;
  const pendingCount = data.pending_count - overdueCount;

  // 按天数范围过滤发票（与 Tab 一一对应）
  const countByTab = (tabKey: TabKey): number => {
    if (!reminders?.invoices) return 0;
    const today = dayjs();
    return reminders.invoices.filter((inv: any) => {
      if (!inv.payment_date) return false;
      const daysLeft = dayjs(inv.payment_date).diff(today, 'day');
      switch (tabKey) {
        case 'overdue': return daysLeft < 0;
        case '30': return daysLeft >= 0 && daysLeft <= 30;
        case '60': return daysLeft > 30 && daysLeft <= 60;
        case '90': return daysLeft > 60 && daysLeft <= 90;
        case '120': return daysLeft > 90 && daysLeft <= 120;
        case '150': return daysLeft > 120 && daysLeft <= 150;
        case '180': return daysLeft > 150 && daysLeft <= 180;
        default: return false;
      }
    }).length;
  };

  // Tab 筛选发票（复用相同逻辑）
  const getFilteredInvoices = () => {
    if (!reminders?.invoices) return [];
    const today = dayjs();
    return reminders.invoices.filter((inv: any) => {
      if (!inv.payment_date) return false;
      const daysLeft = dayjs(inv.payment_date).diff(today, 'day');
      switch (activeTab) {
        case 'overdue': return daysLeft < 0;
        case '30': return daysLeft >= 0 && daysLeft <= 30;
        case '60': return daysLeft > 30 && daysLeft <= 60;
        case '90': return daysLeft > 60 && daysLeft <= 90;
        case '120': return daysLeft > 90 && daysLeft <= 120;
        case '150': return daysLeft > 120 && daysLeft <= 150;
        case '180': return daysLeft > 150 && daysLeft <= 180;
        default: return false;
      }
    });
  };

  const filteredInvoices = getFilteredInvoices();

  // Tab 配置（计数从同一份列表实时计算，保证数字与下方列表一致）
  const tabs: { key: TabKey; label: string; count: number; danger?: boolean }[] = [
    { key: 'overdue', label: '已逾期', count: countByTab('overdue'), danger: true },
    { key: '30', label: '30天内', count: countByTab('30') },
    { key: '60', label: '60天内', count: countByTab('60') },
    { key: '90', label: '90天内', count: countByTab('90') },
    { key: '120', label: '120天内', count: countByTab('120') },
    { key: '150', label: '150天内', count: countByTab('150') },
    { key: '180', label: '180天内', count: countByTab('180') },
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
      {contextHolder}
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>仪表盘</h2>
        <p>发票管理系统总览</p>
      </div>

      {/* 第一行：金额总览 */}
      <div className="yb-stat-grid yb-stat-grid--3">
        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">总金额</div>
            <div className="stat-value">{data.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="stat-sub">所有发票金额合计</div>
          </div>
          <div className="stat-icon" style={{ background: '#e6f4ff', color: '#1677ff' }}>
            <WalletOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">已付合计</div>
            <div className="stat-value" style={{ color: '#52c41a' }}>{data.paid_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="stat-sub">已付款发票金额合计</div>
          </div>
          <div className="stat-icon" style={{ background: '#f6ffed', color: '#52c41a' }}>
            <CheckCircleOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">待付合计</div>
            <div className="stat-value" style={{ color: '#fa8c16' }}>{data.total_payable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="stat-sub">未付款发票金额合计（含已逾期）</div>
          </div>
          <div className="stat-icon" style={{ background: '#fff7e6', color: '#fa8c16' }}>
            ¥
          </div>
        </div>
      </div>

      {/* 第二行：3个统计卡片 */}
      <div className="yb-stat-grid yb-stat-grid--3">
        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">总发票数</div>
            <div className="stat-value" style={{ color: '#1677ff' }}>{data.total_invoices}</div>
            <div className="stat-sub">系统中总的发票总数</div>
          </div>
          <div className="stat-icon" style={{ background: '#e6f4ff', color: '#1677ff' }}>
            <FileTextOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">
              当前账期
              <Button
                type="link"
                size="small"
                icon={<SettingOutlined />}
                onClick={openPeriodModal}
                style={{ padding: 0, marginLeft: 8, fontSize: 13, height: 'auto' }}
              >
                设置
              </Button>
            </div>
            <div className="stat-value" style={{ color: '#ff4d4f' }}>{getAccountPeriod()}<span style={{ fontSize: 16, marginLeft: 4, fontWeight: 400 }}>天</span></div>
            <div className="stat-sub">付款日期 = 开票日期 + 账期</div>
          </div>
          <div className="stat-icon" style={{ background: '#f6ffed', color: '#52c41a' }}>
            <CalendarOutlined />
          </div>
        </div>

        <div className="yb-stat-card">
          <div className="stat-main">
            <div className="stat-label">供应商数量</div>
            <div className="stat-value" style={{ color: '#722ed1' }}>{data.supplier_count}</div>
            <div className="stat-sub">合作供应商总数</div>
          </div>
          <div className="stat-icon" style={{ background: '#e6f4ff', color: '#1677ff' }}>
            <TeamOutlined />
          </div>
        </div>
      </div>

      {/* 第三行：状态统计 */}
      <div className="yb-stat-grid yb-stat-grid--3">
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

      {/* 数据驾驶舱：可视化图表 */}
      {analytics && (
        <div style={{ marginTop: 20 }}>
          <div className="yb-card-title" style={{ marginBottom: 12 }}>
            <PieChartOutlined style={{ color: CHART_BLUE, marginRight: 8 }} />
            数据驾驶舱
            <span style={{ fontSize: 12, color: '#999', fontWeight: 400, marginLeft: 8 }}>可视化数据概览</span>
          </div>

          <Row gutter={[16, 16]} className="cockpit-row">
            {/* 第一行：趋势 + 状态 */}
            <Col xs={24} lg={12}>
              <Card title="近 12 个月开票趋势" className="cockpit-card">
                <TrendChart data={analytics.monthlyTrend} />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="付款状态分布" className="cockpit-card">
                <StatusDonut data={analytics.statusDistribution} />
              </Card>
            </Col>

            {/* 第二行：账龄 + 供应商 */}
            <Col xs={24} lg={12}>
              <Card title="未来 6 个月应付预测" className="cockpit-card">
                <AgingBars data={analytics.aging} />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="Top5 供应商应付款" className="cockpit-card">
                <SupplierBars data={analytics.topSuppliers} />
              </Card>
            </Col>

            {/* 第三行：到期分布 + 月度完成率 */}
            <Col xs={24} lg={12}>
              <Card title="待付款到期分布" className="cockpit-card">
                <PaymentDueDist data={analytics.paymentDueDist} />
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="本月付款完成率" className="cockpit-card">
                <MonthlyRate data={{
                  ratio: analytics.monthPaidRatio,
                  paid: analytics.monthPaidTotal,
                  due: analytics.monthDueTotal,
                  overallRatio: analytics.paidRatio,
                  overallPaid: analytics.paidAmount,
                  overallTotal: analytics.totalAmount,
                }} />
              </Card>
            </Col>
          </Row>

          {/* 深度分析：账龄 / 现金流 / 风险 / 结构 */}
          <div style={{ marginTop: 24 }}>
            <div className="yb-card-title" style={{ marginBottom: 12 }}>
              <PieChartOutlined style={{ color: CHART_BLUE, marginRight: 8 }} />
              深度分析
              <span style={{ fontSize: 12, color: '#999', fontWeight: 400, marginLeft: 8 }}>账龄 · 现金流 · 风险 · 结构</span>
            </div>
            <Row gutter={[16, 16]} className="cockpit-row" align="stretch">
              <Col xs={24} lg={12}>
                <Card title="标准账龄分析" className="cockpit-card">
                  <StandardAgingTable invoices={allInvoices} />
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="月度结构（已付 / 待付 / 逾期）" className="cockpit-card">
                  <MonthlyStackedBar invoices={allInvoices} />
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="供应商应付款占比" className="cockpit-card">
                  <SupplierTreemap invoices={allInvoices} />
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title="未来 13 周付款日历" className="cockpit-card">
                  <PaymentCalendarHeatmap invoices={allInvoices} />
                </Card>
              </Col>

              <RiskAlertPanel invoices={allInvoices} navigate={navigate} />
            </Row>
          </div>
        </div>
      )}

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
                          {daysLeft < 0 ? '逾期' : '剩余'} {Math.abs(daysLeft)} 天
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="yb-invoice-right">
                    <div className="yb-invoice-amount" style={{ color: '#1677ff' }}>
                      {inv.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

      {/* 账期设置弹窗 */}
      <Modal
        title="设置账期"
        open={periodModalOpen}
        onCancel={() => setPeriodModalOpen(false)}
        onOk={handleSavePeriod}
        confirmLoading={savingPeriod}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>当前账期：{getAccountPeriod()} 天</div>
          <div style={{ fontSize: 13, color: '#999' }}>系统默认付款日期 = 开票日期 + 账期天数。保存后所有发票会按新账期重新计算。</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>快速选择</div>
          <Space wrap>
            {[30, 60, 90, 120, 150, 180].map((d) => (
              <Button
                key={d}
                type={periodValue === d ? 'primary' : 'default'}
                onClick={() => setPeriodValue(d)}
                style={{ minWidth: 64 }}
              >
                {d} 天
              </Button>
            ))}
          </Space>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>自定义天数</span>
          <InputNumber
            min={1}
            max={365}
            value={periodValue}
            onChange={(v) => setPeriodValue(v ?? 90)}
            addonAfter="天"
            style={{ width: 160 }}
          />
        </div>
      </Modal>
    </div>
  );
}

/* ----------------- 驾驶舱图表子组件（零依赖，antd + 内联 SVG） ----------------- */

function TrendChart({ data }: { data: any[] }) {
  const { line, area, pts, w, h, padX, padY } = buildTrendPaths(data);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * w;
    let idx = 0;
    let min = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - svgX);
      if (d < min) { min = d; idx = i; }
    });
    setHover(idx);
  };

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const hp = hover !== null ? pts[hover] : null;
  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative' }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_BLUE} stopOpacity={0.25} />
            <stop offset="100%" stopColor={CHART_BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        {gridLines.map((g, i) => {
          const y = padY + g * (h - padY * 2);
          return <line key={i} x1={padX} y1={y} x2={w - padX} y2={y} stroke="#f0f0f0" strokeWidth={1} />;
        })}
        <path d={area} fill="url(#trendFill)" />
        <path d={line} fill="none" stroke={CHART_BLUE} strokeWidth={2} />
        {/* 悬停竖直参考线 */}
        {hp && (
          <line x1={hp.x} y1={padY} x2={hp.x} y2={h - padY} stroke={CHART_BLUE} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hover === i ? 6 : 4}
            fill={hover === i ? CHART_BLUE : '#fff'}
            stroke={CHART_BLUE}
            strokeWidth={2}
            style={{ transition: 'r 0.1s' }}
          />
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={pts[i].x}
            y={h - 6}
            fontSize={11}
            fill={hover === i ? CHART_BLUE : '#999'}
            fontWeight={hover === i ? 700 : 400}
            textAnchor="middle"
          >
            {d.month.slice(2)}
          </text>
        ))}
      </svg>
      {/* 浮动数据提示 */}
      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(pts[hover].x / w) * 100}%`,
            top: `${(pts[hover].y / h) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 12px))',
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.6,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2,
          }}
        >
          <div style={{ fontWeight: 600 }}>{data[hover].month}</div>
          <div>金额 ¥{data[hover].amount.toLocaleString()}</div>
          <div>{data[hover].count} 张发票</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8 }}>
        {data.map((d, i) => (
          <span key={i} style={{ fontSize: 12, color: hover === i ? CHART_BLUE : '#666', fontWeight: hover === i ? 700 : 400 }}>
            {d.count} 张
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusDonut({ data }: { data: any[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const hovered = data.find((d) => d.status === hover) || null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox="0 0 180 180" style={{ width: 180, height: 180 }}>
        <g transform="rotate(-90 90 90)">
          <circle cx={90} cy={90} r={r} fill="none" stroke="#f0f0f0" strokeWidth={20} />
          {data.map((d) => {
            const len = total > 0 ? (d.count / total) * c : 0;
            const seg = (
              <circle
                key={d.status}
                cx={90} cy={90} r={r}
                fill="none"
                stroke={STATUS_COLOR[d.status]}
                strokeWidth={hover === d.status ? 26 : 20}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                style={{ cursor: 'pointer', transition: 'stroke-width 0.12s', opacity: hover && hover !== d.status ? 0.4 : 1 }}
                onMouseEnter={() => setHover(d.status)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${d.label}：${d.count} 张 · ¥${d.amount.toLocaleString()}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </g>
        <text x={90} y={hover ? 78 : 84} fontSize={hover ? 16 : 24} fontWeight={700} fill="#333" textAnchor="middle">
          {hover ? hovered?.count : total}
        </text>
        <text x={90} y={hover ? 98 : 104} fontSize={12} fill="#999" textAnchor="middle">
          {hover ? hovered?.label : '总发票'}
        </text>
        {hover && (
          <text x={90} y={116} fontSize={11} fill="#999" textAnchor="middle">
            ¥{hovered?.amount.toLocaleString()}
          </text>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {data.map((d) => (
          <div
            key={d.status}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', opacity: hover && hover !== d.status ? 0.4 : 1, transition: 'opacity 0.12s' }}
            onMouseEnter={() => setHover(d.status)}
            onMouseLeave={() => setHover(null)}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLOR[d.status], display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: '#666' }}>{d.label} {d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupplierBars({ data }: { data: any[] }) {
  if (data.length === 0) return <Empty description="暂无供应商数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const max = Math.max(1, ...data.map((d) => d.amount));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
      {data.map((d, i) => (
        <Tooltip key={i} title={`${d.name}：¥${d.amount.toLocaleString()} · ${d.count} 张`}>
          <div style={{ cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, alignItems: 'baseline' }}>
              <span style={{ color: '#333', flex: 1, minWidth: 0 }}>{d.name}</span>
              <span style={{ color: '#666', flexShrink: 0, marginLeft: 12 }}>¥{d.amount.toLocaleString()}</span>
            </div>
            <div style={{ background: '#f5f5f5', borderRadius: 6, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${(d.amount / max) * 100}%`, height: '100%', background: SUPPLIER_COLORS[i % SUPPLIER_COLORS.length], borderRadius: 6 }} />
            </div>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

function AgingBars({ data }: { data: any[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 320;
  const h = 170;
  const bw = 44;
  const gap = (w - bw * data.length) / (data.length + 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {data.map((d, i) => {
          const x = gap + i * (bw + gap);
          const bh = (d.count / max) * (h - 46);
          const y = h - 24 - bh;
          return (
            <g
              key={d.bucket}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              <rect x={x} y={y} width={bw} height={Math.max(bh, 2)} rx={4} fill={hover === i ? '#ff4d4f' : '#ff7875'}>
                <title>{`${d.bucket}：${d.count} 张 · ¥${d.amount.toLocaleString()}`}</title>
              </rect>
              <text x={x + bw / 2} y={y - 6} fontSize={12} fill="#ff4d4f" textAnchor="middle" fontWeight={hover === i ? 700 : 400}>
                {hover === i ? `¥${d.amount.toLocaleString()}` : (d.count || '')}
              </text>
              <text x={x + bw / 2} y={h - 6} fontSize={11} fill="#999" textAnchor="middle">{d.bucket}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ===== 待付款到期分布（按剩余天数分桶的面积图） =====
function PaymentDueDist({ data }: { data: any[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 220;
  const padX = 50, padY = 30, padB = 40;
  const maxVal = Math.max(...data.map((d) => d.amount), 1);
  const cw = (W - padX * 2) / Math.max(data.length, 1);

  const pts = data.map((d, i) => ({
    x: padX + cw * i + cw / 2,
    y: padY + (H - padY - padB) * (1 - d.amount / maxVal),
    d,
  }));

  const line = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
  const area = `${line} L${pts[pts.length - 1].x},${H - padB} L${pts[0].x},${H - padB} Z`;
  const hp = hover !== null ? pts[hover] : null;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="dueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_RED} stopOpacity={0.3} />
            <stop offset="100%" stopColor={CHART_RED} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Y轴网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
          const y = padY + g * (H - padY - padB);
          return <line key={i} x1={padX} y1={y} x2={W - 20} y2={y} stroke="#f0f0f0" strokeWidth={1} />;
        })}
        {/* Y轴标签 */}
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
          const v = Math.round(maxVal * g);
          const y = padY + g * (H - padY - padB);
          return <text key={i} x={padX - 8} y={y + 4} fontSize={11} fill="#999" textAnchor="end">{v >= 10000 ? `${(v/10000).toFixed(0)}万` : v}</text>;
        })}
        <path d={area} fill="url(#dueFill)" />
        <path d={line} fill="none" stroke={CHART_RED} strokeWidth={2.5} />
        {/* 悬停竖直参考线 */}
        {hp && (
          <line x1={hp.x} y1={padY} x2={hp.x} y2={H - padB} stroke={CHART_RED} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hover === i ? 6 : 4.5}
            fill={hover === i ? CHART_RED : '#fff'}
            stroke={CHART_RED}
            strokeWidth={2}
            style={{ transition: 'r 0.1s', cursor: 'pointer' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{p.d.label}：¥{p.d.amount.toLocaleString()} ({p.d.count} 张)</title>
          </circle>
        ))}
        {hover !== null && (
          <text x={pts[hover].x} y={pts[hover].y - 12} fontSize={12} fill={CHART_RED} fontWeight={700} textAnchor="middle">
            ¥{pts[hover].d.amount.toLocaleString()}
          </text>
        )}
        {data.map((d, i) => (
          <text
            key={i}
            x={pts[i].x}
            y={H - 10}
            fontSize={11}
            fill={hover === i ? CHART_RED : '#666'}
            fontWeight={hover === i ? 700 : 400}
            textAnchor="middle"
          >
            {d.label}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 6, flexWrap: 'wrap', gap: 4 }}>
        {data.map((d, i) => (
          <Tooltip key={i} title={`${d.label}：¥${d.amount.toLocaleString()} · ${d.count} 张`}>
            <span style={{ fontSize: 12, color: hover === i ? CHART_RED : '#666', cursor: 'default', fontWeight: hover === i ? 700 : 400 }}>¥{d.amount.toLocaleString()}</span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ===== 本月付款完成率 =====
function MonthlyRate({ data }: { data: { ratio: number; paid: number; due: number; overallRatio: number; overallPaid: number; overallTotal: number } }) {
  return (
    <Tooltip
      title={
        <div style={{ lineHeight: 1.8 }}>
          <div>本月完成率 <b>{data.ratio}%</b></div>
          <div>已付款 ¥{data.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div>本月应付 ¥{data.due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.25)', marginTop: 4, paddingTop: 4 }}>累计完成率 {data.overallRatio}%</div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', cursor: 'help' }}>
        <Progress
          type="dashboard"
          percent={data.ratio}
          strokeColor={data.ratio >= 80 ? '#52c41a' : data.ratio >= 50 ? '#faad14' : '#ff4d4f'}
          size={150}
          format={(p) => `${p}%`}
        />
      <div style={{ fontSize: 13, color: '#999', marginTop: 10, textAlign: 'center', lineHeight: 1.8 }}>
        <div>已付款 <span style={{ color: '#52c41a', fontWeight: 600 }}>¥{data.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <div>本月应付 <span style={{ fontWeight: 600 }}>¥{data.due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0', width: '80%', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#bbb' }}>累计完成率</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1677ff', marginTop: 2 }}>{data.overallRatio}%</div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
          ¥{data.overallPaid.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ¥{data.overallTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
      </div>
    </Tooltip>
  );
}

/* ----------------- 深度分析图表子组件 ----------------- */

// ===== ④ 标准账龄分析表 =====
function StandardAgingTable({ invoices }: { invoices: any[] }) {
  const today = dayjs();
  const unpaid = (invoices || []).filter((i: any) => i.status !== 'paid' && i.payment_date);
  const buckets = [
    { label: '未到期', color: '#1677ff', test: (d: number) => d > 0 },
    { label: '逾期 0-30天', color: '#fa8c16', test: (d: number) => d <= 0 && d >= -30 },
    { label: '逾期 31-60天', color: '#fa541c', test: (d: number) => d <= -31 && d >= -60 },
    { label: '逾期 61-90天', color: '#f5222d', test: (d: number) => d <= -61 && d >= -90 },
    { label: '逾期 90天以上', color: '#a8071a', test: (d: number) => d <= -91 },
  ];
  const rows = buckets.map((b) => {
    const items = unpaid.filter((i: any) => b.test(dayjs(i.payment_date).diff(today, 'day')));
    const amount = Math.round(items.reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100;
    return { ...b, count: items.length, amount };
  });
  const totalAmt = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const totalCnt = rows.reduce((s, r) => s + r.count, 0);
  if (totalCnt === 0) return <Empty description="暂无未付发票" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ color: '#999', textAlign: 'right' }}>
          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500 }}>账龄区间</th>
          <th style={{ padding: '6px 8px', fontWeight: 500 }}>发票数</th>
          <th style={{ padding: '6px 8px', fontWeight: 500 }}>金额</th>
          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500, width: '34%' }}>占比</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pct = totalAmt > 0 ? (r.amount / totalAmt) * 100 : 0;
          return (
            <tr key={r.label} style={{ borderTop: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px 8px', textAlign: 'left' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 8 }} />
                {r.label}
              </td>
              <td style={{ padding: '8px 8px', textAlign: 'right' }}>{r.count}</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.amount)}</td>
              <td style={{ padding: '8px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, background: '#f5f5f5', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: r.color, borderRadius: 4 }} />
                  </div>
                  <span style={{ color: '#999', fontSize: 12, width: 44, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          );
        })}
        <tr style={{ borderTop: '2px solid #e8e8e8', fontWeight: 700 }}>
          <td style={{ padding: '8px 8px', textAlign: 'left' }}>合计</td>
          <td style={{ padding: '8px 8px', textAlign: 'right' }}>{totalCnt}</td>
          <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmtMoney(totalAmt)}</td>
          <td style={{ padding: '8px 8px', color: '#999', fontSize: 12 }}>100%</td>
        </tr>
      </tbody>
    </table>
  );
}

// ===== ⑩ 月度结构堆叠条形（已付 / 待付 / 逾期） =====
function MonthlyStackedBar({ invoices }: { invoices: any[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const now = dayjs();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(now.subtract(i, 'month').format('YYYY-MM'));
  const data = months.map((m) => {
    const items = (invoices || []).filter((i: any) => (i.invoice_date || '').slice(0, 7) === m);
    const sum = (st: string) =>
      Math.round(items.filter((i: any) => i.status === st).reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0) * 100) / 100;
    return { month: m, paid: sum('paid'), pending: sum('pending'), overdue: sum('overdue') };
  });
  const W = 640, H = 260, padX = 46, padY = 20, padB = 38;
  const chartH = H - padY - padB;
  const maxVal = Math.max(1, ...data.map((d) => d.paid + d.pending + d.overdue));
  const cw = (W - padX * 2) / data.length;
  const barW = Math.min(26, cw * 0.6);
  const segs = [
    { key: 'pending' as const, label: '待付款', color: '#fa8c16' },
    { key: 'overdue' as const, label: '已逾期', color: '#ff4d4f' },
    { key: 'paid' as const, label: '已付款', color: '#52c41a' },
  ];
  if (data.every((d) => d.paid + d.pending + d.overdue === 0)) {
    return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
          const y = padY + g * chartH;
          const v = Math.round(maxVal * g);
          return (
            <g key={i}>
              <line x1={padX} y1={y} x2={W - 12} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <text x={padX - 6} y={y + 4} fontSize={10} fill="#999" textAnchor="end">{fmtShort(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padX + cw * i + (cw - barW) / 2;
          const total = d.paid + d.pending + d.overdue;
          let yCursor = padY + chartH;
          const rects = segs.map((s) => {
            const val = (d as any)[s.key];
            const h = (val / maxVal) * chartH;
            const yTop = yCursor - h;
            yCursor = yTop;
            return { ...s, h, y: yTop, val };
          });
          const hp = hover === i;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <title>{`${d.month}\n待付 ¥${d.pending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n逾期 ¥${d.overdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n已付 ¥${d.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</title>
              {rects.map((r) => (
                <rect key={r.key} x={x} y={r.y} width={barW} height={Math.max(r.h, 0.5)} fill={r.color} opacity={hover !== null && !hp ? 0.4 : 1} />
              ))}
              <text x={x + barW / 2} y={H - 12} fontSize={10} fill={hp ? CHART_BLUE : '#666'} textAnchor="middle">{d.month.slice(2)}</text>
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <rect x={padX + cw * hover} y={padY} width={cw} height={chartH} fill={CHART_BLUE} opacity={0.06} />
            <text x={padX + cw * hover + cw / 2} y={padY - 6} fontSize={11} fill={CHART_BLUE} textAnchor="middle" fontWeight={700}>
              {fmtMoney(data[hover].paid + data[hover].pending + data[hover].overdue)}
            </text>
          </g>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        {segs.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ===== ⑦ 供应商应付款占比树图（Squarified Treemap） =====
const TREEMAP_COLORS = ['#1677ff', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96', '#52c41a', '#fa541c', '#2f54eb', '#faad14', '#a0d911', '#f5222d', '#1890ff'];

interface TreeDatum { name: string; value: number; count: number; color: string; }
interface TreeRect extends TreeDatum { x: number; y: number; w: number; h: number; }
interface TreeItem extends TreeDatum { area: number; }

function squarify(data: TreeDatum[], x: number, y: number, w: number, h: number): TreeRect[] {
  const result: TreeRect[] = [];
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const items: TreeItem[] = data.map((d) => ({ ...d, area: (d.value / total) * w * h }));
  let cx = x, cy = y, cw = w, ch = h;
  let i = 0;
  const worst = (row: TreeItem[], side: number) => {
    let sum = 0, max = 0, min = Infinity;
    for (const r of row) { sum += r.area; if (r.area > max) max = r.area; if (r.area < min) min = r.area; }
    if (min === 0) min = 0.0001;
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (i < items.length) {
    let row: TreeItem[] = [];
    let best = Infinity;
    let j = i;
    while (j < items.length) {
      const candidate = row.concat(items[j]);
      const wv = worst(candidate, Math.min(cw, ch));
      if (row.length === 0 || wv <= best) { row = candidate; best = wv; j++; } else break;
    }
    const rowSum = row.reduce((s, r) => s + r.area, 0);
    if (cw >= ch) {
      const colW = rowSum / ch;
      let yy = cy;
      for (const r of row) { const rh = r.area / colW; result.push({ ...r, x: cx, y: yy, w: colW, h: rh }); yy += rh; }
      cx += colW; cw -= colW;
    } else {
      const rowH = rowSum / cw;
      let xx = cx;
      for (const r of row) { const rw = r.area / rowH; result.push({ ...r, x: xx, y: cy, w: rw, h: rowH }); xx += rw; }
      cy += rowH; ch -= rowH;
    }
    i = j;
  }
  return result;
}

function SupplierTreemap({ invoices }: { invoices: any[] }) {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  (invoices || []).forEach((i: any) => {
    const name = (i.supplier_name || '未知').trim();
    const cur = map.get(name) || { name, amount: 0, count: 0 };
    cur.amount += Number(i.total_amount) || 0;
    cur.count += 1;
    map.set(name, cur);
  });
  const entries = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  const top = entries.slice(0, 12);
  const rest = entries.slice(12);
  const restAmount = rest.reduce((s, e) => s + e.amount, 0);
  const restCount = rest.reduce((s, e) => s + e.count, 0);
  let data: TreeDatum[] = top.map((e, idx) => ({ name: e.name, value: Math.round(e.amount * 100) / 100, count: e.count, color: TREEMAP_COLORS[idx % TREEMAP_COLORS.length] }));
  if (restAmount > 0) data.push({ name: `其他 ${restCount} 家`, value: Math.round(restAmount * 100) / 100, count: restCount, color: '#bfbfbf' });
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty description="暂无供应商数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const W = 640, H = 300, pad = 4;
  const rects = squarify(data, pad, pad, W - pad * 2, H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {rects.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={Math.max(r.w - 2, 0)} height={Math.max(r.h - 2, 0)} rx={3} fill={r.color}>
            <title>{`${r.name}\n金额 ${fmtMoney(r.value)} (${total > 0 ? ((r.value / total) * 100).toFixed(1) : 0}%)\n${r.count} 张发票`}</title>
          </rect>
          {r.w > 56 && r.h > 30 && (
            <>
              <text x={r.x + 6} y={r.y + 16} fontSize={11} fill="#fff" fontWeight={600}>{r.name.length > 8 ? r.name.slice(0, 8) + '…' : r.name}</text>
              <text x={r.x + 6} y={r.y + 32} fontSize={11} fill="rgba(255,255,255,0.92)">{fmtShort(r.value)}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

// ===== ① 未来 13 周付款日历热力图 =====
function PaymentCalendarHeatmap({ invoices }: { invoices: any[] }) {
  const today = dayjs();
  const map = new Map<string, { amount: number; count: number }>();
  (invoices || []).filter((i: any) => i.status !== 'paid' && i.payment_date).forEach((i: any) => {
    const k = (i.payment_date || '').slice(0, 10);
    if (!k) return;
    const cur = map.get(k) || { amount: 0, count: 0 };
    cur.amount += Number(i.total_amount) || 0;
    cur.count += 1;
    map.set(k, cur);
  });
  const weeks = 13;
  const firstDay = today.subtract((today.day() + 6) % 7, 'day'); // 本周一
  const maxVal = Math.max(1, ...Array.from(map.values()).map((v) => v.amount));
  const colorOf = (amt: number) => {
    if (amt <= 0) return '#f0f0f0';
    const r = amt / maxVal;
    if (r >= 0.75) return '#cf1322';
    if (r >= 0.5) return '#ff7875';
    if (r >= 0.25) return '#ffccc7';
    return '#fff1f0';
  };
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const cellsByWeek: { date: any; amount: number; count: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { date: any; amount: number; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = firstDay.add(w * 7 + d, 'day');
      const info = map.get(date.format('YYYY-MM-DD'));
      col.push({ date, amount: info?.amount || 0, count: info?.count || 0 });
    }
    cellsByWeek.push(col);
  }
  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 4, minWidth: 330 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 2, justifyContent: 'space-between', padding: '2px 0' }}>
            {weekdays.map((d) => (
              <div key={d} style={{ fontSize: 10, color: '#999', height: 18, lineHeight: '18px', width: 14, textAlign: 'center' }}>{d}</div>
            ))}
          </div>
          {cellsByWeek.map((col, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {col.map((cell, di) => {
                const isToday = cell.date.isSame(today, 'day');
                return (
                  <Tooltip key={di} title={
                    <div style={{ lineHeight: 1.7 }}>
                      <div>{cell.date.format('YYYY-MM-DD')}{isToday ? '（今天）' : ''}</div>
                      <div>待付 ¥{cell.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div>{cell.count} 张发票</div>
                    </div>
                  }>
                    <div style={{
                      width: 18, height: 18, borderRadius: 3, background: colorOf(cell.amount),
                      border: isToday ? '2px solid #1677ff' : '1px solid rgba(0,0,0,0.04)',
                      boxSizing: 'border-box', cursor: 'default',
                    }} />
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#999', justifyContent: 'flex-end' }}>
        <span>少</span>
        {['#f0f0f0', '#fff1f0', '#ffccc7', '#ff7875', '#cf1322'].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, display: 'inline-block', border: '1px solid rgba(0,0,0,0.04)' }} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

// ===== ⑤ 风险预警面板（大额逾期 + 即将到期） =====
function RiskAlertPanel({ invoices, navigate }: { invoices: any[]; navigate: (p: string) => void }) {
  const today = dayjs();
  const list = (invoices || []).filter((i: any) => i.payment_date);
  const overdue = list.filter((i: any) => i.status === 'overdue')
    .map((i: any) => ({ ...i, days: today.diff(dayjs(i.payment_date), 'day') }))
    .sort((a, b) => b.total_amount - a.total_amount).slice(0, 10);
  const nearDue = list.filter((i: any) => i.status !== 'paid')
    .map((i: any) => ({ ...i, daysLeft: dayjs(i.payment_date).diff(today, 'day') }))
    .filter((i: any) => i.daysLeft >= 0 && i.daysLeft <= 15)
    .sort((a, b) => b.total_amount - a.total_amount).slice(0, 10);

  const RowItem = ({ inv, kind }: { inv: any; kind: 'overdue' | 'near' }) => (
    <div
      onClick={() => navigate(`/invoice-list?id=${inv.id}`)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
    >
      <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
        <div style={{ fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(inv.supplier_name || '未知').replace(/^(名称[：:\s]*)/, '')}
        </div>
        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{inv.invoice_no || '-'}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ color: '#1677ff', fontWeight: 600, fontSize: 14 }}>{fmtMoney(Number(inv.total_amount) || 0)}</div>
        <Tag color={kind === 'overdue' ? 'red' : 'volcano'} style={{ fontSize: 11, marginTop: 2 }}>
          {kind === 'overdue' ? `逾期 ${inv.days} 天` : `${inv.daysLeft} 天后到期`}
        </Tag>
      </div>
    </div>
  );

  return (
    <>
      <Col xs={24} lg={12}>
        <Card title="大额逾期 TOP 10（按金额）" className="cockpit-card">
          {overdue.length > 0 ? overdue.map((inv) => <RowItem key={inv.id} inv={inv} kind="overdue" />) : <Empty description="无逾期发票" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="即将到期 TOP 10（15 天内 · 按金额）" className="cockpit-card">
          {nearDue.length > 0 ? nearDue.map((inv) => <RowItem key={inv.id} inv={inv} kind="near" />) : <Empty description="无即将到期" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
    </>
  );
}
