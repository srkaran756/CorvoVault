import { Activity } from '../../../src/types';

export interface ActivityRepository {
  log(profileId: string, action: string, metadata?: Record<string, any>): Promise<void>;
  getByProfileId(profileId: string, limit?: number): Promise<Activity[]>;
  getHeatmap(profileId: string, days: number): Promise<any[]>;
  getWeekSummary(profileId: string): Promise<any>;
  getTopDistractors(profileId: string, days: number): Promise<any[]>;
  logMobileUsage(profileId: string, data: any): Promise<void>;
}
