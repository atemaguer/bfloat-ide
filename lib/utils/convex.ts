const BASE_URL = 'https://api.convex.dev/v1'

interface TokenDetails {
  type: string
  teamId: string
  name: string
  createTime: string
}

interface ConvexProject {
  projectId: number
  deploymentName: string
  deploymentUrl: string
}

export const getTokenDetails = async (convexAccessToken: string): Promise<TokenDetails> => {
  const res = await fetch(`${BASE_URL}/token_details`, {
    headers: {
      Authorization: `Bearer ${convexAccessToken}`,
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch token details: ${res.statusText}`)
  }

  return res.json()
}

export const createConvex = async ({
  projectName,
  convexAccessToken,
}: {
  projectName: string
  convexAccessToken: string
}): Promise<ConvexProject> => {
  console.log('[Convex] Creating Convex project:', projectName)
  const { teamId: TEAM_ID } = await getTokenDetails(convexAccessToken)

  console.log('[Convex] Using Convex team ID:', TEAM_ID)

  if (!TEAM_ID) {
    throw new Error('Convex token does not have a team ID')
  }

  const res = await fetch(`${BASE_URL}/teams/${TEAM_ID}/create_project`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${convexAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      deploymentType: 'dev',
      projectName,
    }),
  })

  const json = await res.json()
  console.log('[Convex] Project created:', json)

  return json
}

export const createDeploymentKey = async ({
  convexDeployment,
  convexAccessToken,
}: {
  convexDeployment: string
  convexAccessToken: string
}): Promise<string> => {
  const res = await fetch(`${BASE_URL}/deployments/${convexDeployment}/create_deploy_key`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${convexAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'bfloat-generated-key',
    }),
  })

  const json = await res.json()
  console.log('[Convex] Created Convex deployment key')

  return json.deployKey
}
