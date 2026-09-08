import { api } from "./api-client.js";

export class TaxService {
  #api;

  constructor({ apiClient = api } = {}) {
    this.#api = apiClient;
  }

  calculateMaximum({ ncm, originState, destinationState, unitValue }) {
    return this.#api.post("/tax/calculate", {
      ncm,
      originState,
      destinationState,
      quantity: 1,
      unitValue,
    });
  }
}
