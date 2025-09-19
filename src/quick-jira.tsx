import { Form, ActionPanel, Action, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { useEffect, useState } from "react";

interface FormValues {
  summary: string;
  description?: string;
  team: string;
  project: string;
  issueType: string;
}

interface Preferences {
  jiraEmail: string;
  jiraApiToken: string;
}

interface TeamOption {
  value: string;
  label: string;
}

export default function QuickJiraCreate() {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);

  async function fetchTeams() {
    try {
      const preferences = getPreferenceValues<Preferences>();
      const auth = Buffer.from(`${preferences.jiraEmail}:${preferences.jiraApiToken}`).toString('base64');
      
      // Use the createmeta endpoint to get custom field options
      const response = await fetch('https://viam.atlassian.net/rest/api/2/issue/createmeta?projectKeys=RSDK&expand=projects.issuetypes.fields', {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const project = data.projects?.[0];
        const issueType = project?.issuetypes?.[0];
        const teamField = issueType?.fields?.customfield_10074;
        
        if (teamField?.allowedValues) {
          const teamOptions = teamField.allowedValues.map((option: any) => ({
            value: option.value,
            label: option.value
          }));
          setTeams(teamOptions);
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load teams",
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoadingTeams(false);
    }
  }

  useEffect(() => {
    fetchTeams();
  }, []);

  async function createJiraIssue(values: FormValues) {
    const preferences = getPreferenceValues<Preferences>();
    const auth = Buffer.from(`${preferences.jiraEmail}:${preferences.jiraApiToken}`).toString('base64');
    
    const issueData = {
      fields: {
        project: {
          key: values.project
        },
        summary: values.summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: values.description || ''
                }
              ]
            }
          ]
        },
        issuetype: {
          name: values.issueType
        },
        customfield_10074: [{ value: values.team }] // Team custom field as array
      }
    };

    const response = await fetch('https://viam.atlassian.net/rest/api/3/issue', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(issueData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.errorMessages?.[0] || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  async function handleSubmit(values: FormValues) {
    try {
      const result = await createJiraIssue(values);
      await showToast({
        style: Toast.Style.Success,
        title: "Issue Created",
        message: `${result.key}: ${values.summary}`
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: `Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm onSubmit={handleSubmit} title="Create Issue" />
        </ActionPanel>
      }
    >
      <Form.TextField 
        id="summary" 
        title="Summary" 
        placeholder="Brief description of the issue"
      />
      
      <Form.TextArea 
        id="description" 
        title="Description" 
        placeholder="Detailed description (optional)"
      />
      
      <Form.Dropdown id="project" title="Project" defaultValue="RSDK">
        <Form.Dropdown.Item value="RSDK" title="RSDK" />
        <Form.Dropdown.Item value="APP" title="APP" />
        <Form.Dropdown.Item value="DATA" title="DATA" />
      </Form.Dropdown>
      
      <Form.Dropdown id="issueType" title="Issue Type" defaultValue="Bug">
        <Form.Dropdown.Item value="Bug" title="🐛 Bug" />
        <Form.Dropdown.Item value="Feature" title="✨ Feature" />
        <Form.Dropdown.Item value="Improvement" title="🔧 Improvement" />
      </Form.Dropdown>
      
      <Form.Dropdown id="team" title="Team" isLoading={isLoadingTeams}>
        {teams.map((team) => (
          <Form.Dropdown.Item key={team.value} value={team.value} title={team.label} />
        ))}
      </Form.Dropdown>
      
      <Form.Separator />
      
      <Form.Description text="This will create a new Jira issue with the specified details." />
    </Form>
  );
}
