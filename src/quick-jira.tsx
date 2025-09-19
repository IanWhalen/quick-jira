import { Form, ActionPanel, Action, showToast, Toast, getPreferenceValues, Clipboard, closeMainWindow, popToRoot } from "@raycast/api";
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
  anthropicApiKey: string;
}

interface TeamOption {
  value: string;
  label: string;
}

export default function QuickJiraCreate() {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

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

  async function generateSummary() {
    if (!description.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: "Please enter a description first"
      });
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const preferences = getPreferenceValues<Preferences>();
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': preferences.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 50,
          messages: [
            {
              role: 'user',
              content: `Return ONLY a 7-word maximum Jira summary. No explanations, no notes, no quotes. Just the summary.

Examples:
- "Module reload fails with zero versions"
- "Neopixel initialization error on Pi5"
- "API timeout during user authentication"

Description: ${description}

Summary:`
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        let generatedSummary = data.content[0].text.trim();
        
        // Clean up the response - remove quotes, notes, explanations
        generatedSummary = generatedSummary
          .replace(/^["']|["']$/g, '') // Remove quotes
          .split('\n')[0] // Take only first line
          .split('.')[0] // Take only before period
          .trim();
        
        // Limit to 7 words
        const words = generatedSummary.split(' ');
        if (words.length > 7) {
          generatedSummary = words.slice(0, 7).join(' ');
        }
        
        setSummary(generatedSummary);
        await showToast({
          style: Toast.Style.Success,
          title: "Summary Generated",
          message: "Claude-generated summary ready"
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to generate summary",
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  }

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

    console.log('Sending to Jira:', JSON.stringify(issueData, null, 2));

    const response = await fetch('https://viam.atlassian.net/rest/api/3/issue', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(issueData)
    });
    
    console.log('Jira response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.log('Jira error response:', JSON.stringify(errorData, null, 2));
      throw new Error(JSON.stringify(errorData, null, 2));
    }

    return await response.json();
  }

  async function handleSubmit(values: FormValues) {
    try {
      let finalSummary = summary;
      
      // Auto-generate summary if not provided
      if (!summary.trim() && description.trim()) {
        await showToast({
          style: Toast.Style.Animated,
          title: "Generating summary...",
          message: "Claude is creating a summary"
        });
        
        // Generate summary and wait for it
        setIsGeneratingSummary(true);
        try {
          const preferences = getPreferenceValues<Preferences>();
          
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': preferences.anthropicApiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 50,
              messages: [
                {
                  role: 'user',
                  content: `Return ONLY a 7-word maximum Jira summary. No explanations, no notes, no quotes. Just the summary.

Examples:
- "Module reload fails with zero versions"
- "Neopixel initialization error on Pi5"
- "API timeout during user authentication"

Description: ${description}

Summary:`
                }
              ]
            })
          });

          if (response.ok) {
            const data = await response.json();
            let generatedSummary = data.content[0].text.trim();
            
            // Clean up the response - remove quotes, notes, explanations
            generatedSummary = generatedSummary
              .replace(/^["']|["']$/g, '') // Remove quotes
              .split('\n')[0] // Take only first line
              .split('.')[0] // Take only before period
              .trim();
            
            // Limit to 7 words
            const words = generatedSummary.split(' ');
            if (words.length > 7) {
              generatedSummary = words.slice(0, 7).join(' ');
            }
            
            finalSummary = generatedSummary;
            setSummary(finalSummary);
          } else {
            throw new Error(`Failed to generate summary: HTTP ${response.status}`);
          }
        } finally {
          setIsGeneratingSummary(false);
        }
      }
      
      console.log('Final submission data:', {
        summary: finalSummary,
        description,
        project: values.project,
        issueType: values.issueType,
        team: values.team
      });
      
      // Use final values for issue creation
      const issueData = {
        ...values,
        summary: finalSummary,
        description
      };
      const result = await createJiraIssue(issueData);
      
      // Copy issue link to clipboard
      const issueUrl = `https://viam.atlassian.net/browse/${result.key}`;
      await Clipboard.copy(issueUrl);
      
      await showToast({
        style: Toast.Style.Success,
        title: "Issue Created",
        message: `${result.key} - Link copied to clipboard`
      });
      
      // Close Raycast after brief delay
      setTimeout(() => {
        closeMainWindow();
        popToRoot();
      }, 1500);
    } catch (error) {
      console.error('Submit error:', error);
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
          <Action 
            title="Generate Summary" 
            onAction={generateSummary} 
            isLoading={isGeneratingSummary}
            shortcut={{ modifiers: ["cmd"], key: "g" }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea 
        id="description" 
        title="Description" 
        placeholder="Detailed description of the issue"
        value={description}
        onChange={setDescription}
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
      
      <Form.TextField 
        id="summary" 
        title="Summary" 
        placeholder="Auto-generated by Claude (or enter manually)"
        value={summary}
        onChange={setSummary}
      />
      
      <Form.Description text="This will create a new Jira issue with the specified details." />
    </Form>
  );
}
