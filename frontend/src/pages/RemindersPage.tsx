import { useState, useEffect } from 'react';
import { Table, Tag, Statistic, Row, Col, Card } from 'antd';
import {
  AlertOutlined, ClockCircleOutlined, WarningOutlined,
  CalendarOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { dashboardApi } from '../api/client';
import dayjs from 'dayjs';

export default function RemindersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const columns = [
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier', width: 180, ellipsis: true },
    { title: '发票号码', dataIndex: 'invoice_no', key: 'no', width: 160, ellipsis: true },
    { title: '开票日期', dataIndex: 'invoice_date', key: 'inv_date', width: 110 },
    {
      title: '付款截止日', dataIndex: 'payment_date', key: 'pay_date', width: 120,
      render: (v: string) => v ? <b>{v}</b> : '-',
    },
    {
      title: '到期状态', key: 'status', width: 140,
      render: (_: any, record: any) => getStatusTag(getDaysLeft(record.payment_date)),
    },
    {
      title: '价税合计', dataIndex: 'total_amount', key: 'amount', width: 130,
      render: (v: number) => <b>¥{v.toLocaleString()}</b>,
    },
  ];

  if (!data) return null;

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>到期提醒</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="15天内到期" value={data.due_within_15} prefix={<AlertOutlined />} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="30天内到期" value={data.due_within_30} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="60��内到期" value={data.due_within_60} prefix={<WarningOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="90��内到期" value={data.due_within_90} prefix={<CalendarOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
      </Row>

      {data.overdue > 0 && (
        <Card style={{ marginBottom: 16, borderColor: '#ff4d4f' }}>
          <Statistic
            title="已���期"
            value={data.overdue}
            prefix={<ExclamationCircleOutlined />}
            valueStyle={{ color: '#ff4d4f' }}
            suffix="张发票"
          />
        </Card>
      )}

      <Card title="到期/逾期发票清单">
        <Table
          dataSource={data.invoices}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{ showTotal: (total) => `共 ${total} 张` }}
          scroll={{ x: 900 }}
        />
      </Card>
    </div>
  );
}
