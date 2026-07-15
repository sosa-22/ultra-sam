import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const secretToken = process.env.ACCESS_SECRET;
  
  // If the secret token is not configured in the environment variables, deny access by default
  if (!secretToken) {
    return new NextResponse(
      JSON.stringify({ 
        error: 'Acceso Restringido: La variable de entorno ACCESS_SECRET no está configurada.' 
      }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
  
  const url = request.nextUrl;
  const tokenParam = url.searchParams.get('token');
  const authCookie = request.cookies.get('auth_token')?.value;

  // 1. If the correct token is provided in the URL query parameters
  if (tokenParam === secretToken) {
    // Create redirection to the clean path (remove ?token=... from address bar)
    const cleanUrl = new URL(url.pathname, request.url);
    const response = NextResponse.redirect(cleanUrl);
    
    // Set a secure httpOnly cookie valid for 90 days
    response.cookies.set('auth_token', secretToken, {
      path: '/',
      maxAge: 60 * 60 * 24 * 90, // 90 days
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    
    return response;
  }

  // 2. If the user already has the valid authentication cookie
  if (authCookie === secretToken) {
    return NextResponse.next();
  }

  // 3. Otherwise, deny access with a 403 Forbidden page
  return new NextResponse(
    JSON.stringify({ 
      error: 'Acceso Restringido. Utiliza tu enlace de acceso personal con token para ingresar.' 
    }),
    { 
      status: 403, 
      headers: { 'Content-Type': 'application/json' } 
    }
  );
}

// Apply this proxy rule to all routes except assets and APIs
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
