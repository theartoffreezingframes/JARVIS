/**
 * Note editor. Saves to the server; when offline the change is queued.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Row,
  Screen,
  Stack,
  Type,
} from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/query';
import { useNoteMutations, useProjects } from '../../hooks/useLibrary';
import { describeFailure } from '../../hooks/useTasks';
import { spacing, usePalette } from '../../lib/theme';
import type { Note } from '@jarvis/shared';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { projects } = useProjects();
  const mutations = useNoteMutations();
  const query = useQuery<Note | null>(id ? `note:${id}` : null, async () => {
    const payload = await api.get<{ note: Note }>(`/api/notes/${id}`);
    return payload.note;
  });

  const note = query.data ?? null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setBody(note.body);
    setProjectId(note.projectId);
    setDirty(false);
  }, [note?.id, note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading && !note) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Loading note" />
      </Screen>
    );
  }

  if (!note) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        {missing ? (
          <Card>
            <Type variant="bodyStrong">This note no longer exists.</Type>
          </Card>
        ) : query.error ? (
          <ErrorBlock message="This note could not be loaded." onRetry={() => void query.refetch()} />
        ) : (
          <LoadingBlock label="Loading note" />
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button
          label="Delete"
          variant="ghost"
          icon="trash-outline"
          onPress={() =>
            Alert.alert('Delete note?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await mutations.remove(note.id);
                  router.back();
                },
              },
            ])
          }
        />
      </Row>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      <Card>
        <Stack gap={spacing.md}>
          <Field label="Title">
            <Input
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setDirty(true);
              }}
              placeholder="Note title"
            />
          </Field>
          <Field label="Body">
            <Input
              value={body}
              onChangeText={(value) => {
                setBody(value);
                setDirty(true);
              }}
              placeholder="Write anything…"
              multiline
              style={{ minHeight: 240, textAlignVertical: 'top' }}
            />
          </Field>
          <Field label="Project">
            <Row gap={spacing.sm} wrap>
              <Chip
                label="None"
                selected={!projectId}
                onPress={() => {
                  setProjectId(null);
                  setDirty(true);
                }}
              />
              {projects.map((project) => (
                <Chip
                  key={project.id}
                  label={project.name}
                  color={project.color}
                  selected={projectId === project.id}
                  onPress={() => {
                    setProjectId(project.id);
                    setDirty(true);
                  }}
                />
              ))}
            </Row>
          </Field>
          <Row gap={spacing.sm} wrap>
            {note.taskId ? <Badge label="Attached to a task" color={palette.info} /> : null}
            <Button
              label={note.pinned ? 'Unpin' : 'Pin to top'}
              size="sm"
              variant="secondary"
              onPress={() => void mutations.update(note.id, { pinned: !note.pinned })}
            />
          </Row>
          {dirty ? (
            <Button
              label="Save note"
              icon="save-outline"
              loading={saving}
              onPress={async () => {
                setSaving(true);
                try {
                  await mutations.update(note.id, { title, body, projectId });
                  invalidate(`note:${note.id}`, 'notes');
                  setDirty(false);
                  setMessage('Saved.');
                } catch (error) {
                  setMessage(describeFailure(error).message);
                } finally {
                  setSaving(false);
                }
              }}
            />
          ) : (
            <Type variant="caption" color={palette.textFaint}>
              Last updated {new Date(note.updatedAt).toLocaleString()}
            </Type>
          )}
        </Stack>
      </Card>
    </Screen>
  );
}
