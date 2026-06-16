import { ActivityRepository } from '../repositories/interfaces/ActivityRepository';
import { Activity } from '../../src/types';

export class AnalyticsService {
  constructor(private activityRepo: ActivityRepository) {}

  async logActivity(profileId: string, action: string, metadata?: Record<string, any>): Promise<void> {
    return this.activityRepo.log(profileId, action, metadata);
  }

  async getRecentActivities(profileId: string, limit: number = 100): Promise<Activity[]> {
    return this.activityRepo.getByProfileId(profileId, limit);
  }

  async logMobileUsage(profileId: string, data: any): Promise<void> {
    return this.activityRepo.logMobileUsage(profileId, data);
  }

  async getHeatmap(profileId: string, days: number): Promise<any[]> {
    return this.activityRepo.getHeatmap(profileId, days);
  }

  async getWeekSummary(profileId: string): Promise<any> {
    return this.activityRepo.getWeekSummary(profileId);
  }

  async getTopDistractors(profileId: string, days: number): Promise<any[]> {
    return this.activityRepo.getTopDistractors(profileId, days);
  }
}
