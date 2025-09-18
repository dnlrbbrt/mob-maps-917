import Constants from 'expo-constants';
import { supabase } from '../../supabase';

type Extra = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };

export async function uploadImageFromUri(bucket: string, storagePath: string, uri: string): Promise<string> {
  const extra = (Constants.expoConfig?.extra || {}) as Extra;
  const baseUrl = extra.SUPABASE_URL as string;
  const anon = extra.SUPABASE_ANON_KEY as string;
  if (!baseUrl || !anon) throw new Error('Supabase config missing');

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const form = new FormData();
  form.append('file', { uri, name: storagePath.split('/').pop() || 'upload.jpg', type: 'image/jpeg' } as any);

  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
      'x-upsert': 'false'
    } as any,
    body: form
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Upload failed: ${resp.status}`);
  }
  return storagePath;
}


