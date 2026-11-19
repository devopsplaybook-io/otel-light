import axios from "axios";
import { SERVER_URL } from "./Config";
import { AuthService } from "./AuthService";
import type { SearchSignalType } from "./SearchQuery";

export interface SavedViewRecord {
  id: string;
  userId: string;
  name: string;
  signalType: SearchSignalType;
  query: string;
  shared: boolean;
  dateCreated?: string;
  dateUpdated?: string;
}

export class SavedViewsService {
  //
  public static async list(
    signalType: SearchSignalType,
  ): Promise<SavedViewRecord[]> {
    const response = await axios.get(
      `${SERVER_URL}/saved-views?signalType=${encodeURIComponent(signalType)}`,
      await AuthService.getAuthHeader(),
    );
    return response.data?.views || [];
  }

  public static async create(payload: {
    name: string;
    signalType: SearchSignalType;
    query: string;
    shared: boolean;
  }): Promise<SavedViewRecord> {
    const response = await axios.post(
      `${SERVER_URL}/saved-views`,
      payload,
      await AuthService.getAuthHeader(),
    );
    return response.data?.view;
  }

  public static async update(
    id: string,
    payload: { name?: string; shared?: boolean },
  ): Promise<SavedViewRecord> {
    const response = await axios.patch(
      `${SERVER_URL}/saved-views/${encodeURIComponent(id)}`,
      payload,
      await AuthService.getAuthHeader(),
    );
    return response.data?.view;
  }

  public static async remove(id: string): Promise<void> {
    await axios.delete(
      `${SERVER_URL}/saved-views/${encodeURIComponent(id)}`,
      await AuthService.getAuthHeader(),
    );
  }
}
