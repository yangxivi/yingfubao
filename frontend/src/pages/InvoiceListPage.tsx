import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Table, Button, Space, Input, Select, Tag, Modal, Descriptions,
  message, Popconfirm, Card, Row, Col, Drawer, Form, DatePicker,
  Checkbox, Statistic, Image, Tooltip, Collapse, Upload,
} from 'antd';
import {
  SearchOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, PlusOutlined, DownloadOutlined,
  PictureOutlined, FilterOutlined, ExportOutlined,
  FileTextOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection as AntTableRowSelection } from 'antd/es/table/interface';
import { invoiceApi, supplierApi } from '../api/client';
import { getAccountPeriod } from '../lib/accountPeriod';
import dayjs from 'dayjs';

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState(0);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  // 多选
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // 高级筛选（可折叠）
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [dateFrom, setDateFrom] = useState<dayjs.Dayjs | null>(null);
  const [dateTo, setDateTo] = useState<dayjs.Dayjs | null>(null);
  const [payDateFrom, setPayDateFrom] = useState<dayjs.Dayjs | null>(null);
  const [payDateTo, setPayDateTo] = useState<dayjs.Dayjs | null>(null);
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
      if (payDateFrom) params.pay_date_from = payDateFrom.format('YYYY-MM-DD');
      if (payDateTo) params.pay_date_to = payDateTo.format('YYYY-MM-DD');
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

  const handleDelete = async (id: string) => {
    try {
      await invoiceApi.delete(id);
      message.success('已删除');
      fetchInvoices();
    } catch (err) { /* handled */ }
  };

  // 批量删除
  const [batchDeleting, setBatchDeleting] = useState(false);
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      await Promise.all(selectedRowKeys.map((id) => invoiceApi.delete(id)));
      message.success(`已删除 ${selectedRowKeys.length} 条发票`);
      setSelectedRowKeys([]);
      fetchInvoices();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
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

  const handleMarkPaid = async (id: string) => {
    try {
      await invoiceApi.update(id, { status: 'paid' });
      message.success('已标记为已付款');
      fetchInvoices();
    } catch (err) { /* handled */ }
  };

  // 详情页上传/更换发票图片（压缩后存储）
  const handleDetailImageUpload: any = async (options: any) => {
    if (!selectedInvoice) return;
    try {
      setDetailUploading(true);
      // 压缩图片：缩放到 1200px 宽 + JPEG 0.75 质量
      const file = options.file;
      let base64: string;
      if (file.type.startsWith('image/')) {
        base64 = await new Promise<string>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_W = 1200;
            if (width > MAX_W) { height = Math.round(height * MAX_W / width); width = MAX_W; }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas 不可用')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
          };
          img.onerror = () => reject(new Error('图片加载失败'));
          img.src = URL.createObjectURL(file);
        });
      } else {
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('文件读取失败'));
          reader.readAsDataURL(file);
        });
      }
      await invoiceApi.update(selectedInvoice.id, { image_data: base64 });
      // 用函数式更新避免直接 mutate 引用
      setSelectedInvoice((prev: any) => prev ? { ...prev, image_data: base64 } : prev);
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

  // 全局汇总
  const globalSummary = useMemo(() => {
    const paidCount = invoices.filter((i) => i.status === 'paid').length;
    const pendingCount = invoices.filter((i) => i.status === 'pending').length;
    const overdueCount = invoices.filter((i) => i.status === 'overdue').length;
    const totalAmount = Math.round(invoices.reduce((s, i) => s + (i.total_amount || 0), 0) * 100) / 100;
    return { count: invoices.length, paidCount, pendingCount, overdueCount, totalAmount };
  }, [invoices]);

  // 列定义
  const columns: ColumnsType<any> = [
    {
      title: '发票号码',
      dataIndex: 'invoice_no',
      key: 'no',
      width: 180,
      ellipsis: true,
      render: (v: string) => (
        <span style={{ color: '#1677ff' }}>
          <FileTextOutlined style={{ marginRight: 6 }} />
          {v}
        </span>
      ),
      sorter: (a, b) => (a.invoice_no || '').localeCompare(b.invoice_no || ''),
    },
    {
      title: '供应商',
      dataIndex: 'supplier_name',
      key: 'supplier',
      width: 200,
      ellipsis: true,
      render: (v: string) => (v || '').replace(/^(名称[：:\s]*)/, ''),
      sorter: (a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || ''),
    },
    {
      title: '开票日期',
      dataIndex: 'invoice_date',
      key: 'inv_date',
      width: 110,
      sorter: (a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || ''),
    },
    {
      title: '付款日期',
      dataIndex: 'payment_date',
      key: 'pay_date',
      width: 110,
      sorter: (a, b) => (a.payment_date || '').localeCompare(b.payment_date || ''),
    },
    {
      title: '剩余天数',
      key: 'days_left',
      width: 90,
      sorter: (a, b) => (daysLeft(a.payment_date) ?? 9999) - (daysLeft(b.payment_date) ?? 9999),
      render: (_: any, record: any) => {
        if (record.status === 'paid') return null;
        const dl = daysLeft(record.payment_date);
        if (dl === null) return '-';
        // 负数=已逾期天数，正数=距离付款日剩余天数
        if (dl < 0) return <span style={{ color: '#cf1322', fontWeight: 600 }}>{dl}天</span>;
        if (dl <= 7) return <span style={{ color: '#fa8c16', fontWeight: 600 }}>{dl}天</span>;
        return <span>{dl}天</span>;
      },
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      key: 'amount',
      width: 120,
      sorter: (a, b) => (a.total_amount || 0) - (b.total_amount || 0),
      render: (v: number) => <b style={{ color: '#1677ff' }}>{v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => {
        const map: any = { pending: { color: 'orange', text: '待付款' }, paid: { color: 'green', text: '已付' }, overdue: { color: 'red', text: '已逾期' } };
        const info = map[s] || { color: 'default', text: s };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '附件',
      key: 'thumb',
      width: 60,
      render: (_: any, record: any) =>
        record.image_data ? (
          <Image
            src={record.image_data}
            width={36}
            height={28}
            style={{ borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }}
            preview={{ src: record.image_data }}
          />
        ) : (
          <span style={{ color: '#d9d9d9' }}>—</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={2}>
          <Tooltip title="查看"><Button type="text" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedInvoice(record); setDetailOpen(true); }} /></Tooltip>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setSelectedInvoice(record); setEditOpen(true); }} /></Tooltip>
          {record.status !== 'paid' && (
            <Popconfirm title="确认已付款?" onConfirm={() => handleMarkPaid(record.id)}>
              <Button type="text" size="small" style={{ color: '#52c41a' }}>已付</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 行选择配置
  const rowSelection: AntTableRowSelection<any> = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
    getCheckboxProps: (record: any) => ({ disabled: false }),
  };

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>发票管理</h2>
        <p>管理所有发票信息</p>
      </div>

      {/* 工具栏 */}
      <div className="yb-toolbar">
        <div className="yb-toolbar-left">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索发票号码或供应商名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={fetchInvoices}
            allowClear
            style={{ width: 280 }}
          />
          <Select
            placeholder="全部状态"
            allowClear
            style={{ width: 120 }}
            value={statusFilter || undefined}
            onChange={(v) => { setStatusFilter(v || ''); setTimeout(fetchInvoices, 50); }}
          >
            <Select.Option value="pending">待付款</Select.Option>
            <Select.Option value="paid">已付</Select.Option>
            <Select.Option value="overdue">已逾期</Select.Option>
          </Select>
        </div>
        <div className="yb-toolbar-right">
          <Button icon={<ExportOutlined />}>导出 Excel</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            添加发票
          </Button>
        </div>
      </div>

      {/* 高级筛选面板 */}
      <Collapse
        ghost
        activeKey={filterExpanded ? ['1'] : []}
        onChange={(keys) => setFilterExpanded(keys.includes('1'))}
        style={{ marginBottom: 16 }}
      >
        <Collapse.Panel
          header={
            <span style={{ fontSize: 13, color: filterExpanded ? '#1677ff' : '#666' }}>
              <FilterOutlined style={{ marginRight: 6 }} />
              高级筛选
              {filterExpanded && <span style={{ marginLeft: 8, fontSize: 12, color: '#999' }}>（点击收起）</span>}
            </span>
          }
          key="1"
        >
          <div className="yb-filter-panel">
            <Row gutter={[16, 12]}>
              <Col xs={24} sm={8}>
                <div className="yb-filter-group">
                  <label>📦 供应商</label>
                  <Select
                    placeholder="全部供应商"
                    allowClear showSearch optionFilterProp="children"
                    style={{ width: '100%' }}
                    value={supplierFilter || undefined}
                    onChange={(v) => setSupplierFilter(v || 0)}
                  >
                    {suppliers.map((s: any) => (
                      <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>
                    ))}
                  </Select>
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <div className="yb-filter-group">
                  <label>📅 开票日期（起）</label>
                  <DatePicker style={{ width: '100%' }} value={dateFrom} onChange={(d) => setDateFrom(d)} format="YYYY-MM-DD" placeholder="年-月-日" />
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <div className="yb-filter-group">
                  <label>📅 开票日期（止）</label>
                  <DatePicker style={{ width: '100%' }} value={dateTo} onChange={(d) => setDateTo(d)} format="YYYY-MM-DD" placeholder="年-月-日" />
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <div className="yb-filter-group">
                  <label>💰 付款日期（起）</label>
                  <DatePicker style={{ width: '100%' }} value={payDateFrom} onChange={(d) => setPayDateFrom(d)} format="YYYY-MM-DD" placeholder="年-月-日" />
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <div className="yb-filter-group">
                  <label>💰 付款日期（止）</label>
                  <DatePicker style={{ width: '100%' }} value={payDateTo} onChange={(d) => setPayDateTo(d)} format="YYYY-MM-DD" placeholder="年-月-日" />
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <div className="yb-filter-group">
                  <label>💵 最小金额（元）</label>
                  <Input type="number" placeholder="0.00" value={amountMin} onChange={(e) => setAmountMin(e.target.value ? Number(e.target.value) : undefined)} prefix="¥" allowClear />
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <div className="yb-filter-group">
                  <label>💵 最大金额（元）</label>
                  <Input type="number" placeholder="0.00" value={amountMax} onChange={(e) => setAmountMax(e.target.value ? Number(e.target.value) : undefined)} prefix="¥" allowClear />
                </div>
              </Col>
            </Row>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <Space>
                <Button
                  icon={<CloseCircleOutlined />}
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('');
                    setSupplierFilter(0);
                    setDateFrom(null);
                    setDateTo(null);
                    setPayDateFrom(null);
                    setPayDateTo(null);
                    setAmountMin(undefined);
                    setAmountMax(undefined);
                    setTimeout(fetchInvoices, 50);
                  }}
                >
                  清除筛选
                </Button>
                <Button type="primary" icon={<SearchOutlined />} onClick={fetchInvoices}>查询</Button>
              </Space>
            </div>
          </div>
        </Collapse.Panel>
      </Collapse>

      {/* 表格区域 */}
      <Card bodyStyle={{ padding: 0 }}>
        {/* 多选汇总栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            background: '#e6f7ff',
            borderBottom: '1px solid #91d5ff',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
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
            <Statistic title="选中数量" value={selectedSummary.count} suffix="条" style={{ fontSize: 14 }} valueStyle={{ fontSize: 16, fontWeight: 600 }} />
            <Statistic title="合计金额" value={selectedSummary.totalAmount} prefix="¥" precision={2} style={{ fontSize: 14 }} valueStyle={{ color: '#cf1322', fontWeight: 600, fontSize: 16 }} />
            <div style={{ marginLeft: 'auto' }}>
              <Popconfirm
                title={`确认删除选中的 ${selectedRowKeys.length} 条发票？`}
                description="删除后不可恢复"
                onConfirm={handleBatchDelete}
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />} loading={batchDeleting}>
                  批量删除（{selectedRowKeys.length}）
                </Button>
              </Popconfirm>
            </div>
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

        {/* 底部固定汇总栏 */}
        <div className="yb-summary-bar">
          <div className="yb-summary-item">
            <div className="summary-label">发票总数</div>
            <div className="summary-value">{globalSummary.count}</div>
          </div>
          <div className="yb-summary-item summary-primary">
            <div className="summary-label">金额合计</div>
            <div className="summary-value">{globalSummary.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="yb-summary-item summary-success">
            <div className="summary-label">待付款</div>
            <div className="summary-value">{globalSummary.pendingCount}</div>
          </div>
          <div className="yb-summary-item summary-danger">
            <div className="summary-label">已逾期</div>
            <div className="summary-value">{globalSummary.overdueCount}</div>
          </div>
        </div>
      </Card>

      {/* Detail Drawer */}
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
              <Descriptions.Item label="不含税金额">{(selectedInvoice.amount_excluding_tax || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Descriptions.Item>
              <Descriptions.Item label="税额">{(selectedInvoice.tax_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Descriptions.Item>
              <Descriptions.Item label="价税合计"><b style={{ color: '#cf1322' }}>{(selectedInvoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></Descriptions.Item>
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
          <EditInvoiceForm
            selectedInvoice={selectedInvoice}
            onDone={() => { setEditOpen(false); fetchInvoices(); }}
          />
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
            <Col span={12}><Form.Item label="付款日期" name="payment_date" tooltip={`留空则按开票日期+${getAccountPeriod()}天自动计算`}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
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

// ===== 编辑发票表单（开票日期联动付款日期+账期天数）=====
function EditInvoiceForm({ selectedInvoice, onDone }: { selectedInvoice: any; onDone: () => void }) {
  const [form] = Form.useForm();
  const invoiceDate = Form.useWatch('invoice_date', form);

  // selectedInvoice 变化时重置表单数据（Modal 未销毁时切换编辑对象）
  useEffect(() => {
    if (!selectedInvoice) return;
    form.setFieldsValue({
      invoice_no: selectedInvoice.invoice_no || '',
      business_month: selectedInvoice.business_month || '',
      invoice_date: selectedInvoice.invoice_date ? dayjs(selectedInvoice.invoice_date) : null,
      payment_date: selectedInvoice.payment_date ? dayjs(selectedInvoice.payment_date) : null,
      amount_excluding_tax: selectedInvoice.amount_excluding_tax,
      tax_amount: selectedInvoice.tax_amount,
      total_amount: selectedInvoice.total_amount,
      tax_rate: selectedInvoice.tax_rate,
      status: selectedInvoice.status || 'pending',
      remark: selectedInvoice.remark || '',
    });
  }, [selectedInvoice?.id]); // 仅当编辑不同发票时重置

  // 开票日期变化时，自动计算付款日期 = 开票日期 + 全局账期天数
  useEffect(() => {
    if (invoiceDate && dayjs.isDayjs(invoiceDate)) {
      const payDate = invoiceDate.add(getAccountPeriod(), 'day');
      form.setFieldsValue({ payment_date: payDate });
    }
  }, [invoiceDate]);

  const handleFinish = async (values: any) => {
    try {
      const payload: any = { ...values };
      if (payload.invoice_date) payload.invoice_date = dayjs(payload.invoice_date).format('YYYY-MM-DD');
      if (payload.payment_date) payload.payment_date = dayjs(payload.payment_date).format('YYYY-MM-DD');
      await invoiceApi.update(selectedInvoice.id, payload);
      message.success('更新成功');
      onDone();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '更新失败');
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        // 只取表单实际拥有的字段，避免 image_data/raw_text/userId 等多余字段被提交写回
        invoice_no: selectedInvoice.invoice_no,
        business_month: selectedInvoice.business_month,
        invoice_date: selectedInvoice.invoice_date ? dayjs(selectedInvoice.invoice_date) : null,
        payment_date: selectedInvoice.payment_date ? dayjs(selectedInvoice.payment_date) : null,
        amount_excluding_tax: selectedInvoice.amount_excluding_tax,
        tax_amount: selectedInvoice.tax_amount,
        total_amount: selectedInvoice.total_amount,
        tax_rate: selectedInvoice.tax_rate,
        status: selectedInvoice.status,
        remark: selectedInvoice.remark,
      }}
      onFinish={handleFinish}
    >
      <Row gutter={16}>
        <Col span={12}><Form.Item label="发票号码" name="invoice_no"><Input /></Form.Item></Col>
        <Col span={12}><Form.Item label="业务月份" name="business_month"><Input placeholder="如: 2026年1月" /></Form.Item></Col>
        <Col span={12}>
          <Form.Item label="开票日期" name="invoice_date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="付款日期" name="payment_date" tooltip={`随开票日期自动+${getAccountPeriod()}天，也可手动修改`}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Col>
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
  );
}
