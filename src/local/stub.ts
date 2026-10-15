// Platzhalter für den Server-Build: Das Browser-Backend wird dort nie geladen.
const unavailable = (): never => {
  throw new Error('Nur in der eigenständigen HTML-Version verfügbar');
};
export const localRequest = unavailable;
export const openLocalFile = unavailable;
export const openLocalStandardFile = unavailable;
export const exportBackup = unavailable;
export const importBackup = unavailable;
export const resetLocalData = unavailable;
export const isPersistent = () => false;
export const onPersistenceChange = () => () => undefined;
