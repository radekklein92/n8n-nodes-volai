import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class VolaiApi implements ICredentialType {
  name = 'volaiApi';
  icon = { light: 'file:../icons/volai.svg', dark: 'file:../icons/volai.svg' } as const;
  displayName = 'Volai API';
  documentationUrl = 'https://volai.cz/integrace/n8n';
  properties: INodeProperties[] = [{
    displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '',
    description: 'Create an API key in Volai under API and MCP. The key is sent as a bearer token.',
  }];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };
  test: ICredentialTestRequest = { request: { baseURL: 'https://volai.cz', url: '/v1/balance', method: 'GET' } };
}
