import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Statistic, Tag, Spin, Alert, Image, Empty, Button,
  Row, Col, Progress, Tooltip,
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
  ShopOutlined,
  RightOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '../api/client';
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
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [recentSuppliers, setRecentSuppliers] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overdue');

  useEffect(() => {
    Promise.all([
      dashboardApi.summary(),
      dashboardApi.reminders(),
      dashboardApi.recentInvoices(),
      dashboardApi.recentSuppliers(),
      dashboardApi.analytics(),
    ]).then(([summaryRes, remindersRes, invoicesRes, suppliersRes, analyticsRes]) => {
      setData(summaryRes.data);
      setReminders(remindersRes.data);
      setRecentInvoices(invoicesRes.data);
      setRecentSuppliers(suppliersRes.data);
      setAnalytics(analyticsRes.data);
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
            <div className="stat-value">{data.total_payable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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

      {/* 第三行：最近发票 + 最近供应商 */}
      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        {/* 最近发票 */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <FileTextOutlined style={{ marginRight: 8 }} />
                最近发票
              </span>
            }
            extra={<a onClick={() => navigate('/invoice-list')}>查看全部 <RightOutlined /></a>}
          >
            <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>最新添加的发票记录</p>
            {recentInvoices.length > 0 ? (
              <div>
                {recentInvoices.map((inv: any) => (
                  <div
                    key={inv.id}
                    className="yb-invoice-row"
                    style={{ cursor: 'pointer', marginBottom: 8 }}
                    onClick={() => navigate(`/invoice-list?id=${inv.id}`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{inv.image_data ? '📄' : '📋'}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inv.invoice_no || '-'}
                        </div>
                        <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(inv.supplier_name || '').replace(/^(名称[：:\s]*)/, '')}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                      <div style={{ color: '#1677ff', fontWeight: 600, fontSize: 14 }}>
                        {inv.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <Tag
                        color={inv.status === 'paid' ? 'green' : inv.status === 'overdue' ? 'red' : 'orange'}
                        style={{ fontSize: 11, marginTop: 2 }}
                      >
                        {inv.status === 'paid' ? '已付' : inv.status === 'overdue' ? '已逾期' : '待付款'}
                      </Tag>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="暂无发票" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
            )}
          </Card>
        </Col>

        {/* 最近供应商 */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <ShopOutlined style={{ marginRight: 8 }} />
                最近供应商
              </span>
            }
            extra={<a onClick={() => navigate('/supplier-list')}>查看全部 <RightOutlined /></a>}
          >
            <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>最新添加的供应商信息</p>
            {recentSuppliers.length > 0 ? (
              <div>
                {recentSuppliers.map((sup: any) => (
                  <div
                    key={sup.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 0',
                      borderBottom: '1px solid #f5f5f5',
                      cursor: 'pointer',
                    }}
                    onClick={() => navigate('/supplier-list')}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: '#1677ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(sup.name || '').replace(/^(名称[：:\s]*)/, '')}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        {sup.tax_id || '-'}
                      </div>
                      {sup.contact_person && (
                        <div style={{ fontSize: 12, color: '#1677ff', marginTop: 2 }}>
                          联系人：{sup.contact_person}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: 12, fontSize: 12, color: '#999' }}>
                      {sup.created_at ? sup.created_at.slice(0, 10) : '-'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="暂无供应商" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
            )}
          </Card>
        </Col>
      </Row>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{d.name}</span>
              <span style={{ color: '#666', flexShrink: 0, marginLeft: 8 }}>¥{d.amount.toLocaleString()}</span>
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
          <div>已付 ¥{data.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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
        <div>已付 <span style={{ color: '#52c41a', fontWeight: 600 }}>¥{data.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
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
