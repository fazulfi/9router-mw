import { setAdapterForProcess } from "./driver.js";

const COMMAND_MODULES = {
  createProviderConnection: ["./repos/connectionsRepo.js", "createProviderConnection"],
  updateProviderConnection: ["./repos/connectionsRepo.js", "updateProviderConnection"],
  deleteProviderConnection: ["./repos/connectionsRepo.js", "deleteProviderConnection"],
  deleteProviderConnectionsByProvider: ["./repos/connectionsRepo.js", "deleteProviderConnectionsByProvider"],
  reorderProviderConnections: ["./repos/connectionsRepo.js", "reorderProviderConnections"],
  cleanupProviderConnections: ["./repos/connectionsRepo.js", "cleanupProviderConnections"],
  createProviderNode: ["./repos/nodesRepo.js", "createProviderNode"],
  updateProviderNode: ["./repos/nodesRepo.js", "updateProviderNode"],
  deleteProviderNode: ["./repos/nodesRepo.js", "deleteProviderNode"],
  createProxyPool: ["./repos/proxyPoolsRepo.js", "createProxyPool"],
  updateProxyPool: ["./repos/proxyPoolsRepo.js", "updateProxyPool"],
  deleteProxyPool: ["./repos/proxyPoolsRepo.js", "deleteProxyPool"],
  createApiKey: ["./repos/apiKeysRepo.js", "createApiKey"],
  updateApiKey: ["./repos/apiKeysRepo.js", "updateApiKey"],
  deleteApiKey: ["./repos/apiKeysRepo.js", "deleteApiKey"],
  createCombo: ["./repos/combosRepo.js", "createCombo"],
  updateCombo: ["./repos/combosRepo.js", "updateCombo"],
  deleteCombo: ["./repos/combosRepo.js", "deleteCombo"],
  setModelAlias: ["./repos/aliasRepo.js", "setModelAlias"],
  deleteModelAlias: ["./repos/aliasRepo.js", "deleteModelAlias"],
  addCustomModel: ["./repos/aliasRepo.js", "addCustomModel"],
  deleteCustomModel: ["./repos/aliasRepo.js", "deleteCustomModel"],
  setMitmAliasAll: ["./repos/aliasRepo.js", "setMitmAliasAll"],
  updatePricing: ["./repos/pricingRepo.js", "updatePricing"],
  resetPricing: ["./repos/pricingRepo.js", "resetPricing"],
  resetAllPricing: ["./repos/pricingRepo.js", "resetAllPricing"],
  disableModels: ["./repos/disabledModelsRepo.js", "disableModels"],
  enableModels: ["./repos/disabledModelsRepo.js", "enableModels"],
  updateSettings: ["./repos/settingsRepo.js", "updateSettings"],
  importDb: ["./index.js", "importDb"],
};

export const WRITER_COMMANDS = Object.freeze(Object.keys(COMMAND_MODULES));

export function registerWriterAdapter(adapter) {
  setAdapterForProcess(adapter);
}

export async function executeWriterCommandLocally(command, args) {
  const target = COMMAND_MODULES[command];
  if (!target) throw new Error(`unknown writer command: ${command}`);
  const [modulePath, exportName] = target;
  const module = await import(modulePath);
  return module[exportName](...(Array.isArray(args) ? args : []));
}
