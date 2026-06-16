import { Material } from '../../src/types';
import { MaterialRepository } from '../repositories/interfaces/MaterialRepository';
import { ProfileApplicationService } from './ProfileApplicationService';

export class MaterialApplicationService {
  constructor(
    private materialRepo: MaterialRepository,
    private profiles: ProfileApplicationService
  ) {}

  async getMaterials(folderId: string, profileId: string) {
    return this.materialRepo.getByFolderId(folderId, profileId);
  }

  async getAllMaterials(profileId: string) {
    return this.materialRepo.getAll(profileId);
  }

  async getTrashed(profileId: string) {
    return this.materialRepo.getTrashed(profileId);
  }

  async searchMaterials(profileId: string, query: string) {
    return this.materialRepo.search(profileId, query);
  }

  async capture(type: string, data: any) {
    if (data?.profileId) this.profiles.ensureProfile(data.profileId);
    return this.materialRepo.create(data);
  }

  async getMaterial(id: string): Promise<Material | null> {
    return this.materialRepo.getById(id);
  }

  async captureFile(data: any) {
    return this.capture('file', data);
  }

  async captureLink(data: any) {
    return this.capture('link', data);
  }

  async permanentlyDelete(id: string): Promise<void> {
    return this.materialRepo.delete(id);
  }

  /** Lightweight count query — returns 4 numbers instead of all material rows. */
  getMaterialCounts(profileId: string) {
    return this.materialRepo.getCounts(profileId);
  }
}

