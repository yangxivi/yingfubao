import { useState, useEffect } from 'react';
import { Modal, Button, Steps, message, Alert, Typography, Space, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  CloudOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { probeSupabase } from '../lib/supabase-init';
import { detectAndLockAuthMode } from '../lib/auth';

const { Text, Paragraph, Title } = Typography;

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void; // 建表成功后的回调（通常刷新页面）
}

export default function SetupWizard({ open, onClose, onSuccess }: SetupWizardProps) {
  const [step, setStep] = useState(0); // 0: 说明 → 1: 复制SQL → 2: 验证
  const [sqlCopied, setSqlCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [setupSql, setSetupSql] = useState('');
  const [probeResult, setProbeResult] = useState<any>(null);

  // 打开时探测当前状态
  const handleOpen = async () => {
    setStep(0);
    setSqlCopied(false);
    const result = await probeSupabase();
    setProbeResult(result);
    if (result.setupSql) setSetupSql(result.setupSql);
  };

  // Modal 打开时触发探测（antd Modal 无 onShow，用 effect 监听 open）
  useEffect(() => {
    if (open) handleOpen();
  }, [open]);

  const handleCopySql = () => {
    navigator.clipboard.writeText(setupSql).then(() => {
      setSqlCopied(true);
      message.success('已复制到剪贴板！');
    }).catch(() => {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = setupSql;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setSqlCopied(true);
      message.success('已复制到剪贴板！');
    });
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      // 重新探测
      const result = await probeSupabase();
      if (result.status === 'ready') {
        // 切换到云端模式
        await detectAndLockAuthMode();
        message.success('✅ 云端数据表已就绪！即将刷新页面...');
        setTimeout(() => onSuccess(), 1500);
        return;
      }
      message.error('尚未检测到数据表，请确认 SQL 已执行成功后再试');
      setProbeResult(result);
    } catch (e: any) {
      message.error('验证失败: ' + (e.message || '未知错误'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      centered
      closable={!verifying}
      maskClosable={!verifying}
    >
      <div style={{ padding: '8px 0' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <CloudOutlined style={{ fontSize: 48, color: '#1890ff' }} />
          <Title level={4} style={{ marginTop: 12, marginBottom: 4 }}>
            开启云端同步
          </Title>
          <Text type="secondary">
            完成设置后，你的数据将在不同浏览器/设备间自动同步
          </Text>
        </div>

        {/* Current Status */}
        {probeResult && (
          <Alert
            type={probeResult.status === 'ready' ? 'success' : 'warning'}
            showIcon
            icon={<DatabaseOutlined />}
            message={
              probeResult.status === 'ready'
                ? '✅ 云端已就绪'
                : `⚠️ ${probeResult.message}`
            }
            style={{ marginBottom: 24 }}
          />
        )}

        {/* Steps */}
        <Steps
          current={step}
          size="small"
          style={{ marginBottom: 28 }}
          items={[
            { title: '了解需求', icon: <InfoCircleOutlined /> },
            { title: '执行 SQL', icon: <CopyOutlined /> },
            { title: '验证完成', icon: <CheckCircleOutlined /> },
          ]}
        />

        {/* Step Content */}
        {step === 0 && (
          <div>
            <Paragraph>
              当前你的应付宝运行在<strong>本地模式</strong>——数据只保存在当前浏览器的本地存储中。
              这意味着：
            </Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
              <li>换一台电脑或浏览器，需要重新注册/登录</li>
              <li>不同浏览器之间的数据互不相通</li>
              <li>清除浏览器数据会丢失所有记录</li>
            </ul>
            <Paragraph>
              开启<strong>云端同步</strong>后，所有数据加密存储在 Supabase 云数据库中，
              登录同一账号即可在任何浏览器访问你的发票和供应商数据。
            </Paragraph>
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 4 }}
              message="请在已登录、且存有数据的这台浏览器上完成设置。设置成功后会自动把当前账号与发票同步到云端，之后在其他浏览器用同一账号即可登录并看到全部数据。"
            />

            <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }}>
              <Button onClick={onClose}>暂不开启</Button>
              <Button type="primary" onClick={() => setStep(1)}>
                开始设置
              </Button>
            </Space>
          </div>
        )}

        {step === 1 && (
          <div>
            <Alert
              type="info"
              showIcon
              message={
                <span>
                  请按以下步骤操作（约 1 分钟）：
                </span>
              }
              description={
                <ol style={{ margin: '8px 0 0 20px', padding: 0 }}>
                  <li>打开 <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase Dashboard</a></li>
                  <li>选择项目 <Tag color="blue">dpbtqwfbprartiogydqg</Tag></li>
                  <li>左侧菜单点击 <strong>SQL Editor</strong></li>
                  <li>点击 <strong>New Query</strong></li>
                  <li>粘贴下方 SQL 并点击 <strong>Run</strong></li>
                </ol>
              }
              style={{ marginBottom: 16 }}
            />

            {/* SQL Code Block */}
            <div
              style={{
                background: '#1e1e1e',
                borderRadius: 8,
                padding: 16,
                position: 'relative',
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              <pre style={{ margin: 0, color: '#d4d4d4', fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {setupSql || '加载中...'}
              </pre>
              <Tooltip title={sqlCopied ? '已复制' : '复制 SQL'}>
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  size="small"
                  style={{ position: 'absolute', top: 10, right: 10 }}
                  onClick={handleCopySql}
                >
                  {sqlCopied ? '已复制' : '复制'}
                </Button>
              </Tooltip>
            </div>

            <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 16 }}>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button type="primary" onClick={() => setStep(2)}>
                我已执行完 SQL，下一步
              </Button>
            </Space>
          </div>
        )}

        {step === 2 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
            <Title level={5}>验证云端连接</Title>
            <Paragraph type="secondary">
              点击下方按钮，我们将检测数据表是否创建成功
            </Paragraph>

            <Button
              type="primary"
              size="large"
              icon={<ReloadOutlined spin={verifying} />}
              loading={verifying}
              onClick={handleVerify}
              style={{ marginTop: 8 }}
            >
              {verifying ? '正在验证...' : '验证并完成设置'}
            </Button>

            <div style={{ marginTop: 24 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                验证成功后将自动切换到云端模式并刷新页面
              </Text>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
