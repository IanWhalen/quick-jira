import { Form, ActionPanel, Action, showToast, Toast, getPreferenceValues, Clipboard, closeMainWindow, popToRoot } from "@raycast/api";
import { useEffect, useState } from "react";

interface FormValues {
  summary: string;
  description?: string;
  team: string;
  project: string;
  issueType: string;
  addUxResearchLabel: boolean;
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

interface JiraCreateMetaResponse {
  projects?: Array<{
    issuetypes?: Array<{
      fields?: {
        customfield_10074?: {
          allowedValues?: Array<{ value: string }>;
        };
      };
    }>;
  }>;
}

interface AnthropicResponse {
  content: Array<{
    text: string;
  }>;
}

interface JiraIssueResponse {
  key: string;
  id?: string;
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
        const data = await response.json() as JiraCreateMetaResponse;
        const project = data.projects?.[0];
        const issueType = project?.issuetypes?.[0];
        const teamField = issueType?.fields?.customfield_10074;
        
        if (teamField?.allowedValues) {
          const teamOptions = teamField.allowedValues.map((option) => ({
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
          model: 'claude-haiku-4-5-20251001',
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
        const data = await response.json() as AnthropicResponse;
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
    
    const fields: any = {
      project: {
        key: values.project
      },
      summary: values.summary,
      issuetype: {
        name: values.issueType
      },
      customfield_10074: [{ value: values.team }] // Team custom field as array
    };
    
    // Only include description if it has content, as plain string
    if (values.description && values.description.trim()) {
      fields.description = values.description;
    }

    if (values.addUxResearchLabel) {
      fields.labels = ["ux-research"];
    }
    
    const issueData = {
      fields
    };

    console.log('Sending to Jira:', JSON.stringify(issueData, null, 2));

    const response = await fetch('https://viam.atlassian.net/rest/api/2/issue', {
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
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      try {
        const errorText = await response.text();
        if (errorText) {
          try {
            const errorData = JSON.parse(errorText);
            console.log('Jira error response:', JSON.stringify(errorData, null, 2));
            
            // Extract meaningful error messages from Jira's error response
            if (errorData.errorMessages && errorData.errorMessages.length > 0) {
              errorMessage = errorData.errorMessages.join('; ');
            } else if (errorData.errors && Object.keys(errorData.errors).length > 0) {
              const errorDetails = Object.entries(errorData.errors)
                .map(([field, message]) => `${field}: ${message}`)
                .join('; ');
              errorMessage = `Validation errors: ${errorDetails}`;
            } else if (errorData.message) {
              errorMessage = errorData.message;
            } else {
              errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
            }
          } catch {
            // If JSON parsing fails, use the raw text
            errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
          }
        }
      } catch (textError) {
        // If reading response fails, use status info
        errorMessage = `HTTP ${response.status}: Failed to read error response`;
      }
      
      throw new Error(errorMessage);
    }

    return await response.json() as JiraIssueResponse;
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
              model: 'claude-haiku-4-5-20251001',
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
            const data = await response.json() as AnthropicResponse;
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
        description: values.description || description
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
        <Form.Dropdown.Item value="CONSULT" title="CONSULT" />
        <Form.Dropdown.Item value="DOCS" title="DOCS" />
      </Form.Dropdown>
      
      <Form.Dropdown id="issueType" title="Issue Type" defaultValue="Bug">
        <Form.Dropdown.Item value="Bug" title="🐛 Bug" />
        <Form.Dropdown.Item value="New Feature" title="✨ New Feature" />
        <Form.Dropdown.Item value="Improvement" title="🔧 Improvement" />
        <Form.Dropdown.Item value="Document" title="📄 Document" />
      </Form.Dropdown>
      
      <Form.Dropdown id="team" title="Team" isLoading={isLoadingTeams}>
        {teams.map((team) => (
          <Form.Dropdown.Item key={team.value} value={team.value} title={team.label} />
        ))}
      </Form.Dropdown>
      
      <Form.Checkbox
        id="addUxResearchLabel"
        label="Add ux-research label"
        defaultValue={true}
      />

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
