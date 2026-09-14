export interface ChannelWeightProfile {
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  conversion_rate: number;
  weight: number;
  avg_cost_paise: number;
  sample_size: number;
}

export class AdaptiveStrategyEngine {
  private static epsilon = 0.15; // 15% exploration, 85% exploitation
  private static channelProfiles: Record<string, ChannelWeightProfile> = {
    WHATSAPP: { channel: 'WHATSAPP', conversion_rate: 0.58, weight: 0.55, avg_cost_paise: 250, sample_size: 42 },
    SMS: { channel: 'SMS', conversion_rate: 0.36, weight: 0.30, avg_cost_paise: 50, sample_size: 65 },
    EMAIL: { channel: 'EMAIL', conversion_rate: 0.22, weight: 0.15, avg_cost_paise: 15, sample_size: 38 },
  };

  /**
   * Select optimal outreach channel balancing exploitation with exploration.
   */
  public static selectChannel(ticketAmountPaise: number, preferred?: string): 'WHATSAPP' | 'SMS' | 'EMAIL' {
    // High-value transactions (>₹5,000) favor high-conversion channels (WhatsApp)
    if (ticketAmountPaise >= 500000) {
      return 'WHATSAPP';
    }

    // Epsilon exploration: randomly explore alternative channels
    if (Math.random() < this.epsilon) {
      const channels: ('WHATSAPP' | 'SMS' | 'EMAIL')[] = ['WHATSAPP', 'SMS', 'EMAIL'];
      return channels[Math.floor(Math.random() * channels.length)] ?? 'WHATSAPP';
    }

    // Exploitation: return highest weighted channel
    let bestChannel: 'WHATSAPP' | 'SMS' | 'EMAIL' = 'WHATSAPP';
    let maxWeight = -1;
    for (const p of Object.values(this.channelProfiles)) {
      if (p.weight > maxWeight) {
        maxWeight = p.weight;
        bestChannel = p.channel;
      }
    }
    return bestChannel;
  }

  /**
   * Record conversion outcome and update channel weights using Thompson/heuristic updates.
   */
  public static recordFeedback(channel: 'WHATSAPP' | 'SMS' | 'EMAIL', recovered: boolean): void {
    const profile = this.channelProfiles[channel];
    if (!profile) return;

    profile.sample_size += 1;
    const alpha = 0.1; // Learning rate
    const outcome = recovered ? 1.0 : 0.0;
    profile.conversion_rate = Number((profile.conversion_rate * (1 - alpha) + outcome * alpha).toFixed(4));

    // Recompute normalized weights
    const totalConv = Object.values(this.channelProfiles).reduce((sum, p) => sum + p.conversion_rate, 0);
    if (totalConv > 0) {
      for (const p of Object.values(this.channelProfiles)) {
        p.weight = Number((p.conversion_rate / totalConv).toFixed(3));
      }
    }
  }

  public static getProfiles(): Record<string, ChannelWeightProfile> {
    return { ...this.channelProfiles };
  }
}
