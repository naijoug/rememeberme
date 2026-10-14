import { cloudVocabulary } from './cloud-vocabulary';
import type { BackgroundResponse } from '~/types';

export async function handleCloudMessage(message: unknown): Promise<BackgroundResponse<unknown> | undefined> {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string' || !message.type.startsWith('CLOUD_')) return undefined;
  const input = message as Record<string, unknown>;
  try {
    switch (input.type) {
      case 'CLOUD_STATUS': return { success: true, data: await cloudVocabulary.status() };
      case 'CLOUD_CONNECT':
        if (typeof input.origin !== 'string') throw new Error('Enter an API address.');
        await cloudVocabulary.connect(input.origin); break;
      case 'CLOUD_DISCONNECT': await cloudVocabulary.disconnect(); break;
      case 'CLOUD_OPEN': await cloudVocabulary.openAccount(false); break;
      case 'CLOUD_COPY_LOCAL': await cloudVocabulary.openAccount(true); break;
      case 'CLOUD_USE_LOCAL': await cloudVocabulary.useLocal(); break;
      case 'CLOUD_ENABLE':
        if (typeof input.enabled !== 'boolean') throw new Error('Invalid sync setting.');
        await cloudVocabulary.setEnabled(input.enabled); break;
      case 'CLOUD_SYNC': await cloudVocabulary.synchronize(); break;
      case 'CLOUD_RECOVER': await cloudVocabulary.archiveAndReloadCloud(); break;
      case 'CLOUD_EXPORT_ARCHIVE':
        if (typeof input.key !== 'string') throw new Error('Choose a recovery copy.');
        return { success: true, data: await cloudVocabulary.exportArchive(input.key) };
      default: throw new Error('Unsupported cloud action.');
    }
    return { success: true, data: await cloudVocabulary.status() };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Cloud action failed.' }; }
}
