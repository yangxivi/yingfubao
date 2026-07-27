import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Table, Button, Upload, Space, Input, Select, Tag, Modal, Descriptions,
  message, Popconfirm, Card, Row, Col, Drawer, Form, DatePicker,
  Checkbox, Statistic, Image, Tooltip,
} from 'antd';
import {
  UploadOutlined, SearchOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, PlusOutlined, InboxOutlined, DownloadOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection as AntTableRowSelection } from 'antd/es/table/interface';
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
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const uploadQueue = useRef<Promise<any>>(Promise.resolve());

  // 多选
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  // 高级筛选
  const [dateFrom, setDateFrom] = useState<dayjs.Dayjs | null>(null);
  const [dateTo, setDateTo] = useState<dayjs.Dayjs | null>(null);
  const [amountMin, setAmountMin] = useState<number | undefined>();
  const [amountMax, setAmountMax] = useState<number | undefined>();

  // 详情图片上传
  const [detailUploading, setDetailUploading] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params: any = { page: pagination.current, page_size: pagination.pageSize };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (supplierFilter) params.supplier_id = supplierFilter;
      if (dateFrom) params.date_from = dateFrom.format('YYYY-MM-DD');
      if (dateTo) params.date_to = dateTo.format('YYYY-MM-DD');
      if (amountMin !== undefined) params.amount_min = amountMin;
      if (amountMax !== undefined) params.amount_max = amountMax;
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

  // 剩余天数计算
  const daysLeft = (paymentDate: string): number | null => {
    if (!paymentDate) return null;
    const pd = new Date(paymentDate + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((pd.getTime() - now.getTime()) / 86400000);
  };

  const handleUpload: UploadProps['customRequest'] = (options: any) => {
    const run = async () => {
      try {
        setUploading(true);
        await invoiceApi.upload(options.file, (cur: number, total: number) => {
          setUploadProgress(`正在识别第 ${cur} 张 / 共 ${total} 张`);
        });
        options.onSuccess?.({});
        message.success(`已识别：${options.file.name}`);
        fetchInvoices();
      } catch (err: any) {
        options.onError?.(err);
        const detail = err?.response?.data?.detail || err?.message || '上传失败';
        message.error(`${options.file.name}：${detail}`);
      } finally {
        setUploading(false);
        setUploadProgress('');
      }
    };
    uploadQueue.current = uploadQueue.current.then(run);
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
      message.success('已标记为已付款');
      fetchInvoices();
    } catch (err) { /* handled */ }
  };

  // 详情页上传/更换发票图片
  const handleDetailImageUpload: UploadProps['customRequest'] = async (options: any) => {
    if (!selectedInvoice) return;
    try {
      setDetailUploading(true);
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(options.file);
      });
      await invoiceApi.update(selectedInvoice.id, { image_data: base64 });
      selectedInvoice.image_data = base64;
      options.onSuccess?.({});
      message.success('发票图片已更新');
    } catch (err: any) {
      options.onError?.(err);
      message.error(err?.response?.data?.detail || '图片更新失败');
    } finally {
      setDetailUploading(false);
    }
  };

  // 多选汇总
  const selectedSummary = useMemo(() => {
    const selected = invoices.filter((i) => selectedRowKeys.includes(i.id));
    return {
      count: selected.length,
      totalAmount: Math.round(selected.reduce((s, i) => s + (i.total_amount || 0), 0) * 100) / 100,
    };
  }, [invoices, selectedRowKeys]);

  // 列定义
  const columns: ColumnsType<any> = [
    { title: '发票号码', dataIndex: 'invoice_no', key: 'no', width: 180, ellipsis: true, sorter: (a, b) => (a.invoice_no || '').localeCompare(b.invoice_no || '') },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier', width: 180, ellipsis: true, sorter: (a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '') },
    { title: '开票日期', dataIndex: 'invoice_date', key: 'inv_date', width: 110, sorter: (a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || '') },
    { title: '付款日期', dataIndex: 'payment_date', key: 'pay_date', width: 110, sorter: (a, b) => (a.payment_date || '').localeCompare(b.payment_date || '') },
    {
      title: '价税合计', dataIndex: 'total_amount', key: 'amount', width: 120,
      sorter: (a, b) => (a.total_amount || 0) - (b.total_amount || 0),
      render: (v: number) => <b style={{ color: '#cf1322' }}>¥{v.toLocaleString()}</b>,
    },
    {
      title: '剩余天数', key: 'days_left', width: 90,
      sorter: (a, b) => (daysLeft(a.payment_date) ?? 9999) - (daysLeft(b.payment_date) ?? 9999),
      render: (_: any, record: any) => {
        const dl = daysLeft(record.payment_date);
        if (dl === null) return '-';
        if (dl < 0) return <span style={{ color: '#cf1322', fontWeight: 600 }}>{Math.abs(dl)}天逾期</span>;
        if (dl <= 7) return <span style={{ color: '#fa8c16', fontWeight: 600 }}>{dl}天</span>;
        if (dl <= 30) return <span style={{ color: '#1890ff' }}>{dl}天</span>;
        return <span>{dl}天</span>;
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      filters: [
        { text: '待付款', value: 'pending' },
        { text: '已付款', value: 'paid' },
        { text: '已逾期', value: 'overdue' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (s: string) => {
        const map: any = { pending: { color: 'orange', text: '待付款' }, paid: { color: 'green', text: '已付款' }, overdue: { color: 'red', text: '已逾期' } };
        const info = map[s] || { color: 'default', text: s };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: 200, fixed: 'right' as const,
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

  // 行选择配置
  const rowSelection: AntTableRowSelection<any> = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as number[]),
    getCheckboxProps: (record: any) => ({ disabled: false }),
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>发票管理</h2>

      {/* 上传区域 */}
      <Card style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增发票</Button>
          {uploadProgress && (
            <Tag color="processing" style={{ fontSize: 13 }}>{uploadProgress}</Tag>
          )}
        </Space>
        <Dragger
          customRequest={handleUpload}
          showUploadList={false}
          multiple
          accept=".png,.jpg,.jpeg,.pdf,.bmp,.tiff"
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽发票图片/PDF到此处上传</p>
          <p className="ant-upload-hint">支持 PNG / JPG / PDF / BMP / TIFF，自动OCR识别（可批量选择）</p>
        </Dragger>
      </Card>

      {/* 筛选区域 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} sm={6}>
            <Input prefix={<SearchOutlined />} placeholder="搜索发票号码" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={fetchInvoices} allowClear />
          </Col>
          <Col xs={12} sm={4}>
            <Select placeholder="状态筛选" allowClear style={{ width: '100%' }} value={statusFilter || undefined} onChange={(v) => { setStatusFilter(v || ''); }}>
              <Select.Option value="pending">待付款</Select.Option>
              <Select.Option value="paid">已付款</Select.Option>
              <Select.Option value="overdue">已逾期</Select.Option>
            </Select>
          </Col>
          <Col xs={12} sm={5}>
            <Select placeholder="供应商筛选" allowClear showSearch optionFilterProp="children" style={{ width: '100%' }} value={supplierFilter || undefined} onChange={(v) => setSupplierFilter(v || 0)}>
              {suppliers.map((s: any) => (
                <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <DatePicker placeholder="开始日期" style={{ width: '100%' }} value={dateFrom} onChange={(d) => setDateFrom(d)} format="YYYY-MM-DD" />
          </Col>
          <Col xs={12} sm={4}>
            <DatePicker placeholder="结束日期" style={{ width: '100%' }} value={dateTo} onChange={(d) => setDateTo(d)} format="YYYY-MM-DD" />
          </Col>
        </Row>
        <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
          <Col xs={10} sm={4}>
            <Input type="number" placeholder="金额最小(¥)" value={amountMin} onChange={(e) => setAmountMin(e.target.value ? Number(e.target.value) : undefined)} prefix="¥" allowClear />
          </Col>
          <Col xs={10} sm={4}>
            <Input type="number" placeholder="金额最大(¥)" value={amountMax} onChange={(e) => setAmountMax(e.target.value ? Number(e.target.value) : undefined)} prefix="¥" allowClear />
          </Col>
          <Col xs={4} sm={2}>
            <Button type="primary" onClick={fetchInvoices} block icon={<SearchOutlined />}>查询</Button>
          </Col>
          <Col xs={4} sm={2}>
            <Button onClick={() => { setSearch(''); setStatusFilter(''); setSupplierFilter(0); setDateFrom(null); setDateTo(null); setAmountMin(undefined); setAmountMax(undefined); setTimeout(fetchInvoices, 50); }} block>重置</Button>
          </Col>
        </Row>
      </Card>

      {/* 表格 + 多选汇总 */}
      <Card>
        {/* 多选汇总栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: 4,
            padding: '8px 16px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}>
            <Checkbox
              checked={selectedRowKeys.length === invoices.length && invoices.length > 0}
              indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < invoices.length}
              onChange={(e) => {
                if (e.target.checked) setSelectedRowKeys(invoices.map((i) => i.id));
                else setSelectedRowKeys([]);
              }}
            >
              全选（{selectedRowKeys.length}/{invoices.length}）
            </Checkbox>
            <Statistic title="选中数量" value={selectedSummary.count} suffix="条" style={{ fontSize: 14 }} />
            <Statistic title="合计金额" value={selectedSummary.totalAmount} prefix="¥" precision={2} style={{ fontSize: 14 }} valueStyle={{ color: '#cf1322', fontWeight: 600 }} />
          </div>
        )}

        <Table
          dataSource={invoices}
          columns={columns}
          rowKey="id"
          rowSelection={rowSelection}
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

      {/* Detail Drawer —— 含图片展示与上传 */}
      <Drawer
        title="发票详情"
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailUploading(false); }}
        width={650}
        extra={
          <Space>
            <Upload customRequest={handleDetailImageUpload} showUploadList={false} accept=".png,.jpg,.jpeg,.pdf,.bmp">
              <Button size="small" icon={<PictureOutlined />} loading={detailUploading}>上传/更换发票图</Button>
            </Upload>
          </Space>
        }
      >
        {selectedInvoice && (
          <>
            {/* 发票图片 */}
            {selectedInvoice.image_data && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Image
                  src={selectedInvoice.image_data}
                  alt="原始发票"
                  style={{ maxWidth: '100%', maxHeight: 400 }}
                  fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNhYWEiIGZvbnQtc2l6ZT0iMTQiPuWbvueJh+WKoOi9veWksei0pTwvdGV4dD48L3N2Zz4="
                />
              </div>
            )}

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="发票号码">{selectedInvoice.invoice_no}</Descriptions.Item>
              <Descriptions.Item label="供应商">{selectedInvoice.supplier_name}</Descriptions.Item>
              <Descriptions.Item label="供应商税号">{selectedInvoice.supplier_tax_id}</Descriptions.Item>
              <Descriptions.Item label="开票日期">{selectedInvoice.invoice_date}</Descriptions.Item>
              <Descriptions.Item label="付款日期">{selectedInvoice.payment_date}</Descriptions.Item>
              <Descriptions.Item label="不含税金额">¥{(selectedInvoice.amount_excluding_tax || 0).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="税额">¥{(selectedInvoice.tax_amount || 0).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="价税合计"><b style={{ color: '#cf1322' }}>¥{(selectedInvoice.total_amount || 0).toLocaleString()}</b></Descriptions.Item>
              <Descriptions.Item label="税率">{selectedInvoice.tax_rate}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={selectedInvoice.status === 'paid' ? 'green' : selectedInvoice.status === 'overdue' ? 'red' : 'orange'}>{selectedInvoice.status === 'paid' ? '已付款' : selectedInvoice.status === 'overdue' ? '已逾期' : '待付款'}</Tag></Descriptions.Item>
              {selectedInvoice.remark && <Descriptions.Item label="备注">{selectedInvoice.remark}</Descriptions.Item>}
            </Descriptions>
          </>
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
              <Col span={12}><Form.Item label="发票号码" name="invoice_no"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item label="业务月份" name="business_month"><Input placeholder="如: 2026年1月" /></Form.Item></Col>
              <Col span={12}><Form.Item label="开票日期" name="invoice_date"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
              <Col span={12}><Form.Item label="付款日期" name="payment_date"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
              <Col span={8}><Form.Item label="不含税金额" name="amount_excluding_tax"><Input type="number" /></Form.Item></Col>
              <Col span={8}><Form.Item label="税额" name="tax_amount"><Input type="number" /></Form.Item></Col>
              <Col span={8}><Form.Item label="价税合计" name="total_amount"><Input type="number" /></Form.Item></Col>
              <Col span={12}><Form.Item label="税率" name="tax_rate"><Input placeholder="如: 13%" /></Form.Item></Col>
              <Col span={12}>
                <Form.Item label="状态" name="status">
                  <Select>
                    <Select.Option value="pending">待付款</Select.Option>
                    <Select.Option value="paid">已付款</Select.Option>
                    <Select.Option value="overdue">已逾期</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={24}><Form.Item label="备注" name="remark"><Input.TextArea rows={2} /></Form.Item></Col>
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
            <Col span={12}><Form.Item label="供应商名称（新供应商）" name="supplier_name"><Input placeholder="如未选上方，则按此名称自动建档" /></Form.Item></Col>
            <Col span={12}><Form.Item label="供应商税号" name="supplier_tax_id"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item label="发票号码" name="invoice_no" rules={[{ required: true, message: '请输入发票号码' }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item label="业务月份" name="business_month"><Input placeholder="如: 2026年1月" /></Form.Item></Col>
            <Col span={12}><Form.Item label="开票日期" name="invoice_date" rules={[{ required: true, message: '请选择开票日期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item label="付款日期" name="payment_date" tooltip="留空则按开票日期+90天自动计算"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item label="不含税金额" name="amount_excluding_tax"><Input type="number" /></Form.Item></Col>
            <Col span={8}><Form.Item label="税额" name="tax_amount"><Input type="number" /></Form.Item></Col>
            <Col span={8}><Form.Item label="价税合计" name="total_amount"><Input type="number" /></Form.Item></Col>
            <Col span={12}><Form.Item label="税率" name="tax_rate"><Input placeholder="如: 13%" /></Form.Item></Col>
            <Col span={12}>
              <Form.Item label="状态" name="status">
                <Select>
                  <Select.Option value="pending">待付款</Select.Option>
                  <Select.Option value="paid">已付款</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item label="备注" name="remark"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
          <Button type="primary" htmlType="submit" block>创建</Button>
        </Form>
      </Modal>
    </div>
  );
}
