/**
 * Global search — tasks, projects, habits and notes in one list.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Chip, EmptyState, ErrorBlock, Input, LoadingBlock, Row, Screen, SectionHeader, Stack, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useGlobalSearch, useProjects } from '../hooks/useLibrary';
import { spacing, usePalette } from '../lib/theme';

const TYPES = [
  { value: 'task', label: 'Tasks' },
  { value: 'project', label: 'Projects' },
  { value: 'habit', label: 'Habits' },
  { value: 'note', label: 'Notes' },
];

export default function SearchScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [priority, setPriority] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const { projects } = useProjects();
  const { results, counts, suggestions, isSearching, error, refetch } = useGlobalSearch(query, {
    types: types.length ? types : undefined,
    priority: priority ?? undefined,
    status: status ?? undefined,
    projectId,
  });

  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Capture a task" icon="add" size="sm" onPress={() => router.push('/task-new')} />
      </Row>

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search tasks, projects, habits, notes"
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Global search"
      />

      <Row gap={spacing.sm} wrap>
        {TYPES.map((type) => (
          <Chip
            key={type.value}
            label={type.label}
            small
            selected={types.includes(type.value)}
            onPress={() =>
              setTypes((current) =>
                current.includes(type.value) ? current.filter((item) => item !== type.value) : [...current, type.value],
              )
            }
          />
        ))}
      </Row>

      <Row gap={spacing.sm} wrap>
        {(['urgent', 'high', 'medium', 'low'] as const).map((option) => (
          <Chip
            key={option}
            label={option}
            small
            color={palette.priority[option]}
            selected={priority === option}
            onPress={() => setPriority(priority === option ? null : option)}
          />
        ))}
        {(['todo', 'done'] as const).map((option) => (
          <Chip
            key={option}
            label={option === 'todo' ? 'open' : 'completed'}
            small
            selected={status === option}
            onPress={() => setStatus(status === option ? null : option)}
          />
        ))}
      </Row>

      <Row gap={spacing.sm} wrap>
        {projects.slice(0, 6).map((project) => (
          <Chip
            key={project.id}
            label={project.name}
            small
            color={project.color}
            selected={projectId === project.id}
            onPress={() => setProjectId(projectId === project.id ? null : project.id)}
          />
        ))}
      </Row>

      {query.trim().length === 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Suggestions" subtitle="Jump straight to something recent" />
          {suggestions.length === 0 ? (
            <Card>
              <Type variant="caption" color={palette.textFaint}>
                Start typing — search covers titles, descriptions, notes and tag names.
              </Type>
            </Card>
          ) : (
            suggestions.map((suggestion) => (
              <Card
                key={`${suggestion.type}-${suggestion.id}`}
                onPress={() =>
                  router.push(suggestion.type === 'task' ? `/task/${suggestion.id}` : suggestion.type === 'note' ? `/note/${suggestion.id}` : '/projects')
                }
                accessibilityLabel={suggestion.text}
              >
                <Row gap={spacing.sm}>
                  <Ionicons name={suggestion.type === 'task' ? 'checkbox-outline' : suggestion.type === 'note' ? 'document-text-outline' : 'folder-open-outline'} size={16} color={palette.textMuted} />
                  <Type variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                    {suggestion.text}
                  </Type>
                  <Badge label={suggestion.type} />
                </Row>
              </Card>
            ))
          )}
        </Stack>
      ) : isSearching ? (
        <LoadingBlock label="Searching" />
      ) : error && results.length === 0 ? (
        <ErrorBlock message="Search could not reach the server." onRetry={() => void refetch()} />
      ) : results.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={`No matches for “${query.trim()}”`}
          body="Try a shorter phrase, or capture it as a task instead."
          actionLabel="Capture a task"
          onAction={() => router.push('/task-new')}
        />
      ) : (
        <>
          {counts ? (
            <Row gap={spacing.sm} wrap>
              <Badge label={`${counts.task} tasks`} />
              <Badge label={`${counts.project} projects`} />
              <Badge label={`${counts.habit} habits`} />
              <Badge label={`${counts.note} notes`} />
            </Row>
          ) : null}
          {results.map((result) => {
            const meta = result.meta ?? {};
            return (
            <Card
              key={`${result.type}-${result.id}`}
              onPress={() =>
                router.push(result.type === 'task' ? `/task/${result.id}` : result.type === 'note' ? `/note/${result.id}` : result.type === 'project' ? `/project/${result.id}` : '/habits')
              }
              accessibilityLabel={`${result.type}: ${result.title}`}
            >
              <Stack gap={6}>
                <Row justify="space-between" align="flex-start">
                  <Type variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                    {result.title}
                  </Type>
                  <Badge
                    label={result.type}
                    color={result.type === 'task' ? palette.primary : result.type === 'habit' ? palette.success : palette.info}
                  />
                </Row>
                {result.subtitle ? (
                  <Type variant="caption" color={palette.textMuted} numberOfLines={2}>
                    {result.subtitle}
                  </Type>
                ) : null}
                <Row gap={spacing.sm} wrap>
                  {typeof meta.dueDate === 'string' ? <Badge label={`due ${meta.dueDate}`} color={palette.textMuted} /> : null}
                  {typeof meta.priority === 'string' ? (
                    <Badge label={meta.priority} color={palette.priority[meta.priority as keyof typeof palette.priority]} />
                  ) : null}
                  {typeof meta.projectName === 'string' ? <Badge label={meta.projectName} /> : null}
                  {Array.isArray(meta.tags)
                    ? (meta.tags as string[]).slice(0, 4).map((tag) => <Badge key={tag} label={`#${tag}`} />)
                    : null}
                  {typeof meta.streak === 'number' ? <Badge label={`${meta.streak} day streak`} color={palette.success} /> : null}
                  {typeof meta.status === 'string' ? <Badge label={meta.status} /> : null}
                  {user?.timezone ? null : null}
                </Row>
              </Stack>
            </Card>
            );
          })}
          {results.length >= 20 ? (
            <View>
              <Type variant="caption" color={palette.textFaint}>
                Showing the strongest {results.length} matches. Add a filter to narrow it down.
              </Type>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
