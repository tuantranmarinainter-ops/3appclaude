import { issueLocalSession } from '../../../../src/unifiedSession'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  return issueLocalSession(request)
}
