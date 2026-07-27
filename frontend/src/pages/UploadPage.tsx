import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Upload, Button, Statistic, message, Space, Empty,
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
} from '@ant-design/icons';
import { invoiceApi } from '../api/client';

const { Dragger } = Upload;

export default function UploadPage() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [stats, setStats] = useState({ success: 0, fail: 0, skip: 0 });
  const uploadQueue = useRef<Promise<any>>(Promise.resolve());

  const handleUpload: UploadProps['customRequest'] = (options: any) => {
    const run = async () => {
      try {
        setUploading(true);
        const res = await invoiceApi.upload(options.file, (cur: number, total: number) => {
          setUploadProgress(`正在识别第 ${cur} 张 / 共 ${total} 张`);
        });
        options.onSuccess?.({});
        const inv = res.data as any;
        const supName = inv.supplier_name || inv.seller_name || '未知';
        message.success(`${options.file.name} 已识别，供应商「${supName}」已自动建档`);
        setStats((s) => ({ ...s, success: s.success + 1 }));
      } catch (err: any) {
        options.onError?.(err);
        const detail = err?.response?.data?.detail || err?.message || '上传失败';
        message.error(`${options.file.name}：${detail}`);
        setStats((s) => ({ ...s, fail: s.fail + 1 }));
      } finally {
        setUploading(false);
        setUploadProgress('');
      }
    };
    uploadQueue.current = uploadQueue.current.then(run);
  };

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>发票上传与识别</h2>
        <p>支持批量上传发票图片，自动识别并提取发票信息</p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* 左侧：上传区域 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card bodyStyle={{ padding: 24 }}>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CloudUploadOutlined style={{ fontSize: 18, color: '#1677ff' }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>上传发票与识别</span>
            </div>
            <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
              支持 PNG、PNG 图片格式。文件大小不超过20MB，支持批量上传
            </p>
            <Dragger
              customRequest={handleUpload}
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
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#1677ff', marginBottom: 8 }}>
                    {uploadProgress || '正在识别中…'}
                  </p>
                  <p style={{ color: '#999', fontSize: 13 }}>请稍候，正在处理</p>
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
        <div style={{ width: 280, flexShrink: 0 }}>
          {/* 处理统计 */}
          <Card title="📊 处理统计" size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Statistic
                title="待处理"
                value={stats.success + stats.fail + stats.skip}
                suffix={stats.success + stats.fail + stats.skip > 0 ? '' : '0'}
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
    </div>
  );
}
