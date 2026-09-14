import { AgentToolRegistry } from '../tool_registry.js';

export interface MerchantQueryAnswer {
  query: string;
  answer: string;
  supporting_data: Record<string, any>;
  timestamp: string;
}

export class MerchantCopilot {
  public static async answerMerchantQuery(params: {
    runId: string;
    query: string;
  }): Promise<MerchantQueryAnswer> {
    const q = params.query.toLowerCase();

    if (q.includes('capacity') || q.includes('market') || q.includes('shadow price')) {
      const marketRes = await AgentToolRegistry.executeTool({
        toolId: 'get_market_state',
        runId: params.runId,
        agentName: 'MerchantCopilot',
        inputPayload: {},
      });
      const data = marketRes.data || {};
      const shadowPriceInr = `₹${((data.latest_shadow_price_paise || 0) / 100).toFixed(2)}`;

      return {
        query: params.query,
        answer: `Recovery market capacity is currently at ${data.capacity_used}/${data.capacity_limit} links used (${data.capacity_available} available). Current marginal shadow price is ${shadowPriceInr}.`,
        supporting_data: data,
        timestamp: new Date().toISOString(),
      };
    }

    if (q.includes('gateway') || q.includes('health') || q.includes('latency')) {
      const gwRes = await AgentToolRegistry.executeTool({
        toolId: 'get_gateway_state',
        runId: params.runId,
        agentName: 'MerchantCopilot',
        inputPayload: {},
      });
      const data = gwRes.data || {};

      return {
        query: params.query,
        answer: `Razorpay gateway health is ${(data.overall_health * 100).toFixed(1)}% (p95 latency: ${data.latency_p95_ms}ms). Method success rates: UPI ${(data.upi_success_rate * 100).toFixed(1)}%, Cards ${(data.card_success_rate * 100).toFixed(1)}%.`,
        supporting_data: data,
        timestamp: new Date().toISOString(),
      };
    }

    // Default overview
    const capRes = await AgentToolRegistry.executeTool({
      toolId: 'get_recovery_capacity',
      runId: params.runId,
      agentName: 'MerchantCopilot',
      inputPayload: {},
    });

    return {
      query: params.query,
      answer: `CTRL is operating normally in Razorpay Test Mode with capacity cap ${capRes.data?.capacity_cap || 5} payment links per batch run.`,
      supporting_data: capRes.data || {},
      timestamp: new Date().toISOString(),
    };
  }
}
