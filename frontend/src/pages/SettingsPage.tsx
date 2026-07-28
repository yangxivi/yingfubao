import { useState } from 'react';
import { Card, InputNumber, Button, message, Alert, Space, Typography, Divider } from 'antd';
import { authApi, invoiceApi } from '../api/client';
import { getAccountPeriod } from '../lib/accountPeriod';

const { Title, Paragraph, Text } = Typography;

export default function SettingsPage() {
  const [period, setPeriod] = useState<number>(getAccountPeriod());
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const handleSave = async () => {
    if (!period || period < 1) {
      messageApi.error('账期天数必须大于 0');
      return;
    }
    setSaving(true);
    try {
      await authApi.updateAccountPeriod(period);
      const res = await invoiceApi.recomputePaymentDates();
      const updated = res.data?.updated ?? 0;
      messageApi.success(
        `账期已更新为 ${period} 天，已重新计算 ${updated} 张自动派生付款日期的发票`,
      );
    } catch (err: any) {
      messageApi.error(err?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {contextHolder}
      <div className="yb-page-header">
        <h2>设置</h2>
        <p>全局参数配置</p>
      </div>

      <Card style={{ maxWidth: 640 }}>
        <Title level={5} style={{ marginTop: 0 }}>
          全局账期（会计账期天数）
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          系统默认付款日期 = 开票日期 + 账期天数。修改账期后，所有「自动派生」且未付款的发票会按新账期重新计算付款日期，剩余天数也会随之更新。
        </Paragraph>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Text>账期天数：</Text>
          <InputNumber
            min={1}
            max={365}
            value={period}
            onChange={(v) => setPeriod(v ?? 90)}
            addonAfter="天"
            style={{ width: 160 }}
          />
        </div>

        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message="哪些发票会被重新计算？"
          description={
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>付款日期为「自动派生」（未手动修改）的发票 → 按新账期重算</li>
              <li>已手动修改付款日期的发票 → 保留原值，不受影响</li>
              <li>已付款发票 → 不回溯，保留历史付款日期</li>
            </ul>
          }
        />

        <Divider />
        <Space>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存并重新计算
          </Button>
        </Space>
      </Card>
    </div>
  );
}
