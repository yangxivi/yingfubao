import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Upload, Button, Statistic, message, Space, Empty, Progress,
  Row, Col, Tag,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  CloudUploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlusOutlined,
  UnorderedListOutlined, TeamOutlined,
  DashboardOutlined,
  ShopOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { invoiceApi, dashboardApi } from '../api/client';
import { fetchSharedOcrQuota } from '../lib/ocr';

const { Dragger } = Upload;

export default function UploadPage() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [currentName, setCurrentName] = useState('');
  const [stats, setStats] = useState({ success: 0, fail: 0, skip: 0 });
  const uploadQueue = useRef<Promise<any>>(Promise.resolve());
  // 整批进度用 ref 维护，避免闭包拿到旧的 state
  const batchRef = useRef<{ total: number; done: number }>({ total: 0, done: 0 });
  const resultRef = useRef<{ success: number; fail: number }>({ success: 0, fail: 0 });

  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [recentSuppliers, setRecentSuppliers] = useState<any[]>([]);

  useEffect(() => {
    dashboardApi.recentInvoices().then((res) => setRecentInvoices(res.data || []));
    dashboardApi.recentSuppliers().then((res) => setRecentSuppliers(res.data || []));
  }, []);

  // 抓取整批文件总数（multiple 时 beforeUpload 最后一次 fileList 为全部文件）
  const beforeUpload: UploadProps['beforeUpload'] = (file, fileList) => {
    if (fileList && fileList.length > 0) {
      if (!uploading) {
        batchRef.current = { total: fileList.length, done: 0 };
        resultRef.current = { success: 0, fail: 0 };
        setBatch({ total: fileList.length, done: 0 });
        setUploading(true);
      } else {
        // 正在处理中又来了新一批，合并计数
        batchRef.current.total += fileList.length;
        setBatch((b) => ({ ...b, total: batchRef.current.total }));
      }
    }
    return true; // 交给 customRequest 处理
  };

  const handleUpload: UploadProps['customRequest'] = (options: any) => {
    const run = async () => {
      const cur = batchRef.current.done + 1; // 当前正在处理的第几张
      setCurrentName(options.file.name);
      try {
        const res = await invoiceApi.upload(options.file);
        options.onSuccess?.({});
        const inv = res.data as any;
        const supName = inv.supplier_name || inv.seller_name;
        if (supName) {
          message.success(`${options.file.name} 已识别，供应商「${supName}」已自动建档`);
        } else {
          message.success(`${options.file.name} 已识别并保存`);
        }
        setStats((s) => ({ ...s, success: s.success + 1 }));
        resultRef.current.success += 1;
        // 共享 OCR 额度即时刷新（自有 Key 账号此调用会静默失败，不影响流程）
        fetchSharedOcrQuota().catch(() => {});
      } catch (err: any) {
        options.onError?.(err);
        const detail = err?.response?.data?.detail || err?.message || '上传失败';
        message.error(`${options.file.name}：${detail}`);
        setStats((s) => ({ ...s, fail: s.fail + 1 }));
        resultRef.current.fail += 1;
      } finally {
        batchRef.current.done += 1;
        setBatch({ total: batchRef.current.total, done: batchRef.current.done });
        if (batchRef.current.done >= batchRef.current.total) {
          // 全部完成
          setUploading(false);
          setCurrentName('');
          message.success(
            `已全部完成！共处理 ${batchRef.current.total} 张发票（成功 ${resultRef.current.success} 张，失败 ${resultRef.current.fail} 张）`,
          );
        }
      }
    };
    // 串行处理，保证进度计数准确
    uploadQueue.current = uploadQueue.current.then(run);
  };

  const percent = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>发票上传与识别</h2>
        <p>支持批量上传发票图片，自动识别并提取发票信息</p>
      </div>

      <div className="yb-upload-layout">
        {/* 左侧：上传区域 */}
        <div className="yb-upload-main">
          <Card bodyStyle={{ padding: 24 }}>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CloudUploadOutlined style={{ fontSize: 18, color: '#1677ff' }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>上传发票与识别</span>
            </div>
            <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
              支持 PNG、PNG 图片格式。文件大小不超过20MB，支持批量上传
            </p>
            <Dragger
              className="yb-upload-dragger"
              customRequest={handleUpload}
              beforeUpload={beforeUpload}
              showUploadList={false}
              multiple
              accept=".png,.jpg,.jpeg,.pdf,.bmp,.tiff"
              disabled={uploading}
              style={{
                background: uploading ? '#f0f5ff' : '#fafafa',
                borderColor: uploading ? '#1677ff' : '#d9d9d9',
                padding: '48px 24px',
              }}
            >
              {uploading ? (
                <>
                  <div style={{ fontSize: 40, color: '#1677ff', marginBottom: 12 }}>⏳</div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#1677ff', marginBottom: 6 }}>
                    正在处理第 {Math.min(batch.done + 1, batch.total)} 张 / 共 {batch.total} 张
                  </p>
                  <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
                    {currentName || '准备中…'}
                  </p>
                  <Progress
                    percent={percent}
                    strokeColor="#1677ff"
                    style={{ maxWidth: 320, margin: '0 auto' }}
                  />
                </>
              ) : (
                <>
                  <p style={{ fontSize: 48, color: '#bbb', marginBottom: 12 }}>📤</p>
                  <p style={{ fontSize: 15, color: '#333', marginBottom: 4 }}>
                    拖拽发票文件到此处，或点击选择文件
                  </p>
                  <p style={{ color: '#999', fontSize: 13 }}>
                    支持 JPG、PNG 图片，单个文件不超过 20MB
                  </p>
                  <Button type="link" style={{ marginTop: 4, padding: 0 }}>
                    支持批量上传
                  </Button>
                </>
              )}
            </Dragger>
          </Card>
        </div>

        {/* 右侧：处理统计 + 快捷操作 */}
        <div className="yb-upload-side">
          {/* 处理统计 */}
          <Card title="📊 处理统计" size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Statistic
                title="共处理"
                value={stats.success + stats.fail + stats.skip}
                valueStyle={{ fontSize: 22 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />已成功</span>
                <b style={{ color: '#52c41a' }}>{stats.success}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span><CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />处理失败</span>
                <b style={{ color: '#ff4d4f' }}>{stats.fail}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>跳过</span>
                <b>{stats.skip}</b>
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>总计</span>
                <b>{stats.success + stats.fail + stats.skip}</b>
              </div>
            </Space>
          </Card>

          {/* 快捷操作 */}
          <Card title="→ 快捷操作" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                block
                icon={<UnorderedListOutlined />}
                onClick={() => navigate('/invoice-list')}
              >
                查看发票列表
              </Button>
              <Button
                block
                icon={<TeamOutlined />}
                onClick={() => navigate('/suppliers')}
              >
                管理供应商
              </Button>
              <Button
                block
                icon={<DashboardOutlined />}
                onClick={() => navigate('/')}
              >
                查看仪表盘
              </Button>
            </Space>
          </Card>
        </div>
      </div>

      {/* 最近发票 + 最近供应商 */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }} className="yb-upload-recent-row">
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
                        {inv.status === 'paid' ? '已付款' : inv.status === 'overdue' ? '已逾期' : '待付款'}
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
