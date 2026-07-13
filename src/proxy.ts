import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // Read allowed IPs from the environment variable (separated by commas)
  const allowedIpsEnv = process.env.ALLOWED_IPS || '';
  
  // Default to localhost if no environment variable is defined
  const allowedIps = allowedIpsEnv
    ? allowedIpsEnv.split(',').map(ip => ip.trim())
    : ['127.0.0.1', '::1'];

  // In Vercel, the client IP is passed in the 'x-forwarded-for' or 'x-real-ip' headers
  const ipHeader = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  
  // Get the actual client IP (first one in case of multiple proxies) or fallback to localhost
  const clientIp = ipHeader ? ipHeader.split(',')[0].trim() : '127.0.0.1';

  // If the client's IP is not in the allowed list, block access
  if (!allowedIps.includes(clientIp)) {
    return new NextResponse(
      JSON.stringify({ error: 'Acceso Denegado: IP no autorizada' }),
      { 
        status: 403, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }

  return NextResponse.next();
}

// Configure which paths the proxy should apply to
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
