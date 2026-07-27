import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Statistic, Table, Tag, Spin, Alert } from 'antd';
import {
  FileTextOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '../api/client';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    dashboardApi.summary().then((res) => {
      setData(res.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <Alert type="error" message="加载失败" />;

  const overdueColumns = [
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier' },
    { title: '金额', dataIndex: 'total_amount', key: 'amount', render: (v: number) => `¥${v.toLocaleString()}` },
    { title: '付款截止日', dataIndex: 'payment_date', key: 'date' },
    {
      title: '逾期天数',
      dataIndex: 'days_overdue',
      key: 'days',
      render: (v: number) => <Tag color="red">{v} 天</Tag>,
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>仪表盘</h2>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="发票总数" value={data.total_invoices} prefix={<FileTextOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="待付款" value={data.pending_count} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="逾期发票" value={data.overdue_count} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="应付总额" value={data.total_payable} prefix={<DollarOutlined />} precision={2} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="逾期金额" value={data.overdue_amount} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card><Statistic title="供应商数" value={data.supplier_count} prefix={<TeamOutlined />} /></Card>
        </Col>
      </Row>

      {data.overdue_count > 0 && (
        <Card title="⚠️ 已逾期发票" style={{ marginTop: 24 }} extra={<a onClick={() => navigate('/reminders')}>查看全部</a>}>
          <Table
            dataSource={data.overdue_invoices}
            columns={overdueColumns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} sm={12}>
          <Card hoverable onClick={() => navigate('/invoices')} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <FileTextOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 12 }} />
            <h3>发票管理</h3>
            <p style={{ color: '#999' }}>上传发票、OCR识别、查看明细</p>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card hoverable onClick={() => navigate('/suppliers')} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <TeamOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 12 }} />
            <h3>供应商管理</h3>
            <p style={{ color: '#999' }}>管理供应商信息与往来记录</p>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
