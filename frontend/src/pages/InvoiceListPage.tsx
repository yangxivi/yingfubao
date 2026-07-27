import { useState, useEffect } from 'react';
import {
  Table, Button, Upload, Space, Input, Select, Tag, Modal, Descriptions,
  message, Popconfirm, Card, Row, Col, Drawer, Form, DatePicker,
} from 'antd';
import {
  UploadOutlined, SearchOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, PlusOutlined, InboxOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { invoiceApi, supplierApi } from '../api/client';
import dayjs from 'dayjs';

const { Dragger } = Upload;

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState(0);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, page_size: pagination.pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (supplierFilter) params.supplier_id = supplierFilter;
      const res = await invoiceApi.list(params);
      setInvoices(res.data);
    } catch (err) { /* handled */ }
    finally { setLoading(false); }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await supplierApi.list();
      setSuppliers(res.data);
    } catch (err) { /* handled */ }
  };

  useEffect(() => { fetchInvoices(); }, [pagination.current]);
  useEffect(() => { fetchSuppliers(); }, []);

  const handleUpload: UploadProps['customRequest'] = async (options: any) => {
    setUploading(true);
    try {
      await invoiceApi.upload(options.file);
      message.success('发票上传并识别成功');
      fetchInvoices();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoiceApi.delete(id);
      message.success('已删除');
      fetchInvoices();
    } catch (err) { /* handled */ }
  };

  const handleEdit = async (values: any) => {
    if (!selectedInvoice) return;
    try {
      const payload: any = { ...values };
      if (payload.invoice_date) payload.invoice_date = dayjs(payload.invoice_date).format('YYYY-MM-DD');
      if (payload.payment_date) payload.payment_date = dayjs(payload.payment_date).format('YYYY-MM-DD');
      await invoiceApi.update(selectedInvoice.id, payload);
      message.success('更新成功');
      setEditOpen(false);
      fetchInvoices();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '更新失败');
    }
  };

  const handleCreate = async (values: any) => {
    try {
      const payload: any = { ...values };
      if (payload.invoice_date) payload.invoice_date = dayjs(payload.invoice_date).format('YYYY-MM-DD');
      if (payload.payment_date) payload.payment_date = dayjs(payload.payment_date).format('YYYY-MM-DD');
      await invoiceApi.create(payload);
      message.success('新增成功');
      setCreateOpen(false);
      fetchInvoices();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '新增失败');
    }
  };

  const handleMarkPaid = async (id: number) => {
    try {
      await invoiceApi.update(id, { status: 'paid' });
      message.success('已��记为已付款');
      fetchInvoices();
    } catch (err) { /* handled */ }
  };

  const columns = [
    { title: '发票号码', dataIndex: 'invoice_no', key: 'no', width: 180, ellipsis: true },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier', width: 180, ellipsis: true },
    { title: '开票日期', dataIndex: 'invoice_date', key: 'inv_date', width: 110 },
    { title: '付款截止日', dataIndex: 'payment_date', key: 'pay_date', width: 110 },
    {
      title: '价税合计', dataIndex: 'total_amount', key: 'amount', width: 130,
      render: (v: number) => <b>¥{v.toLocaleString()}</b>,
    },
    {
      title: '税率', dataIndex: 'tax_rate', key: 'rate', width: 60,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => {
        const map: any = { pending: { color: 'orange', text: '待付款' }, paid: { color: 'green', text: '已付款' }, overdue: { color: 'red', text: '已逾期' } };
        const info = map[s] || { color: 'default', text: s };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedInvoice(record); setDetailOpen(true); }}>详情</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedInvoice(record); setEditOpen(true); }}>编辑</Button>
          {record.status !== 'paid' && (
            <Popconfirm title="确认已付款?" onConfirm={() => handleMarkPaid(record.id)}>
              <Button size="small" type="primary" ghost>已付款</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>发票管理</h2>

      <Card style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增发票</Button>
          <span style={{ color: '#888', fontSize: 13 }}>（OCR 未配置时，可手动录入发票与供应商）</span>
        </Space>
        <Dragger
          customRequest={handleUpload}
          showUploadList={false}
          accept=".png,.jpg,.jpeg,.pdf,.bmp,.tiff"
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽发票图片/PDF到此处上传</p>
          <p className="ant-upload-hint">支持 PNG / JPG / PDF / BMP / TIFF，自动OCR识别</p>
        </Dragger>
      </Card>

      <Card>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Input prefix={<SearchOutlined />} placeholder="搜索发票号码" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={fetchInvoices} />
          </Col>
          <Col xs={12} sm={6}>
            <Select placeholder="状态筛选" allowClear style={{ width: '100%' }} value={statusFilter || undefined} onChange={(v) => { setStatusFilter(v || ''); }}>
              <Select.Option value="pending">待付款</Select.Option>
              <Select.Option value="paid">已付款</Select.Option>
              <Select.Option value="overdue">已逾期</Select.Option>
            </Select>
          </Col>
          <Col xs={12} sm={6}>
            <Select placeholder="供应商筛选" allowClear style={{ width: '100%' }} value={supplierFilter || undefined} onChange={(v) => setSupplierFilter(v || 0)}>
              {suppliers.map((s: any) => (
                <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={4}>
            <Button type="primary" onClick={fetchInvoices} block>查询</Button>
          </Col>
        </Row>

        <Table
          dataSource={invoices}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          scroll={{ x: 1100 }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, size) => setPagination((p) => ({ ...p, current: page, pageSize: size })),
          }}
        />
      </Card>

      {/* Detail Drawer */}
      <Drawer title="发票详情" open={detailOpen} onClose={() => setDetailOpen(false)} width={600}>
        {selectedInvoice && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="发票号码">{selectedInvoice.invoice_no}</Descriptions.Item>
            <Descriptions.Item label="供应商">{selectedInvoice.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="供应商税号">{selectedInvoice.supplier_tax_id}</Descriptions.Item>
            <Descriptions.Item label="开票日期">{selectedInvoice.invoice_date}</Descriptions.Item>
            <Descriptions.Item label="付款截止日">{selectedInvoice.payment_date}</Descriptions.Item>
            <Descriptions.Item label="不含税金额">¥{(selectedInvoice.amount_excluding_tax || 0).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="税额">¥{(selectedInvoice.tax_amount || 0).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="价税合计"><b>¥{(selectedInvoice.total_amount || 0).toLocaleString()}</b></Descriptions.Item>
            <Descriptions.Item label="税率">{selectedInvoice.tax_rate}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={selectedInvoice.status === 'paid' ? 'green' : selectedInvoice.status === 'overdue' ? 'red' : 'orange'}>{selectedInvoice.status === 'paid' ? '已付款' : selectedInvoice.status === 'overdue' ? '已逾期' : '待付款'}</Tag></Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      {/* Edit Modal */}
      <Modal title="编辑发票" open={editOpen} onCancel={() => setEditOpen(false)} footer={null} width={600}>
        {selectedInvoice && (
          <Form layout="vertical" initialValues={{
            ...selectedInvoice,
            invoice_date: selectedInvoice.invoice_date ? dayjs(selectedInvoice.invoice_date) : null,
            payment_date: selectedInvoice.payment_date ? dayjs(selectedInvoice.payment_date) : null,
          }} onFinish={handleEdit}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="发票号码" name="invoice_no"><Input /></Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="业务月份" name="business_month"><Input placeholder="如: 2026年1月" /></Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="开票日期" name="invoice_date"><DatePicker style={{ width: '100%' }} /></Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="付款截止日" name="payment_date"><DatePicker style={{ width: '100%' }} /></Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="不含税金额" name="amount_excluding_tax"><Input type="number" /></Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="税额" name="tax_amount"><Input type="number" /></Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="价税合计" name="total_amount"><Input type="number" /></Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="税率" name="tax_rate"><Input placeholder="如: 13%" /></Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="状态" name="status">
                  <Select>
                    <Select.Option value="pending">待付款</Select.Option>
                    <Select.Option value="paid">已付款</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="备注" name="remark"><Input.TextArea rows={2} /></Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" block>保存</Button>
          </Form>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal title="新增发票" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={600}>
        <Form layout="vertical" onFinish={handleCreate} initialValues={{ status: 'pending' }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="供应商" name="supplier_id">
                <Select placeholder="选择已有供应商（可留空，按名称自动创建）" allowClear>
                  {suppliers.map((s: any) => (
                    <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="供应商名称（新供应商）" name="supplier_name"><Input placeholder="如未选上方，则按此名称自动建档" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="供应商税号" name="supplier_tax_id"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="发票号码" name="invoice_no" rules={[{ required: true, message: '请输入发票号码' }]}><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="业务月份" name="business_month"><Input placeholder="如: 2026年1月" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="开票日期" name="invoice_date" rules={[{ required: true, message: '请选择开票日期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="付款截止日" name="payment_date" tooltip="留空则按开票日期+90天自动计算"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="不含税金额" name="amount_excluding_tax"><Input type="number" /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="税额" name="tax_amount"><Input type="number" /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="价税合计" name="total_amount"><Input type="number" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="税率" name="tax_rate"><Input placeholder="如: 13%" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="状态" name="status">
                <Select>
                  <Select.Option value="pending">待付款</Select.Option>
                  <Select.Option value="paid">已付款</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="备注" name="remark"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" block>创建</Button>
        </Form>
      </Modal>
    </div>
  );
}
