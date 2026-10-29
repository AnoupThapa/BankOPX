import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const PUBLIC_KEY = 'bbjp:public';
export const PERMISSION_KEY = 'bbjp:permission';
/** Explicitly unauthenticated route. Everything else is default-deny. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Declares the permission a route needs. Object-level scope is then checked via AccessService.authorize. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);
