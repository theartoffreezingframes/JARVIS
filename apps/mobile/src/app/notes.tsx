/**
 * Notes — lightweight, searchable, attachable to tasks and projects.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Stack,
  Type,
} from '../components/ui';
import { useNoteMutations, useNotes, useProjects } from '../hooks/useLibrary';
import { spacing, usePalette } from '../lib/theme';

export default function NotesScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [noteProject, setNoteProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { notes, isLoading, error, refetch } = useNotes({ search: search || undefined, projectId });
  const { projects } = useProjects();
  const mutations = useNoteMutations();

  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="New note" icon="add" size="sm" onPress={() => setShowNew(true)} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Notes
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {notes.length} note{notes.length === 1 ? '' : 's'} · attach them to a task or project
        </Type>
      </Stack>

      <Input value={search} onChangeText={setSearch} placeholder="Search notes" autoCapitalize="none" accessibilityLabel="Search notes" />

      <Row gap={spacing.sm} wrap>
        <Chip label="All projects" selected={!projectId} onPress={() => setProjectId(null)} />
        {projects.map((project) => (
          <Chip
            key={project.id}
            label={project.name}
            color={project.color}
            selected={projectId === project.id}
            onPress={() => setProjectId(project.id)}
          />
        ))}
      </Row>

      {isLoading && notes.length === 0 ? <LoadingBlock label="Loading notes" /> : null}

      {!isLoading && error && notes.length === 0 ? (
        <ErrorBlock message="Your notes could not be loaded." onRetry={() => void refetch()} />
      ) : null}

      {!isLoading && !error && notes.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={search ? 'No matching notes' : 'No notes yet'}
          body="Notes are for the context that does not fit in a task: decisions, links, half-formed ideas."
          actionLabel="Write a note"
          onAction={() => setShowNew(true)}
        />
      ) : null}

      {notes.map((note) => (
        <Card key={note.id} onPress={() => router.push(`/note/${note.id}`)} accessibilityLabel={`Open note ${note.title}`}>
          <Stack gap={spacing.sm}>
            <Row justify="space-between" align="flex-start">
              <Type variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                {note.title || 'Untitled note'}
              </Type>
              {note.pinned ? <Badge label="Pinned" color={palette.primary} icon="pin" /> : null}
            </Row>
            <Type variant="caption" color={palette.textMuted} numberOfLines={3}>
              {note.body || 'Empty note'}
            </Type>
            <Row gap={spacing.sm} wrap>
              {note.projectId && projectNames.get(note.projectId) ? (
                <Badge label={projectNames.get(note.projectId) ?? ''} />
              ) : null}
              {note.taskId ? <Badge label="Attached to a task" color={palette.info} /> : null}
              <Type variant="micro" color={palette.textFaint}>
                {new Date(note.updatedAt).toLocaleDateString()}
              </Type>
            </Row>
            <Row gap={spacing.sm}>
              <Button label="Open" size="sm" variant="secondary" onPress={() => router.push(`/note/${note.id}`)} />
              <Button
                label={note.pinned ? 'Unpin' : 'Pin'}
                size="sm"
                variant="ghost"
                onPress={() => void mutations.update(note.id, { pinned: !note.pinned })}
              />
              <Button
                label="Delete"
                size="sm"
                variant="ghost"
                onPress={() =>
                  Alert.alert('Delete note?', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => void mutations.remove(note.id) },
                  ])
                }
              />
            </Row>
          </Stack>
        </Card>
      ))}

      <Sheet
        visible={showNew}
        onClose={() => setShowNew(false)}
        title="New note"
        footer={
          <Row gap={spacing.sm}>
            <Button label="Cancel" variant="secondary" onPress={() => setShowNew(false)} />
            <Button
              label="Save note"
              loading={busy}
              disabled={!title.trim() && !body.trim()}
              onPress={async () => {
                setBusy(true);
                try {
                  await mutations.create({ title: title.trim(), body: body.trim(), projectId: noteProject });
                  setTitle('');
                  setBody('');
                  setNoteProject(null);
                  setShowNew(false);
                  void refetch();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        }
      >
        <Field label="Title">
          <Input value={title} onChangeText={setTitle} placeholder="Operating systems — key ideas" />
        </Field>
        <Field label="Body">
          <Input
            value={body}
            onChangeText={setBody}
            placeholder="Write anything…"
            multiline
            style={{ minHeight: 160, textAlignVertical: 'top' }}
          />
        </Field>
        <Field label="Project">
          <Row gap={spacing.sm} wrap>
            <Chip label="None" selected={!noteProject} onPress={() => setNoteProject(null)} />
            {projects.map((project) => (
              <Chip
                key={project.id}
                label={project.name}
                color={project.color}
                selected={noteProject === project.id}
                onPress={() => setNoteProject(project.id)}
              />
            ))}
          </Row>
        </Field>
      </Sheet>
    </Screen>
  );
}
