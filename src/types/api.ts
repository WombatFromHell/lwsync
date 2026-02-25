/**
 * Linkwarden API Types
 * Type definitions for Linkwarden API responses and requests
 */

export interface LinkwardenCollection {
  id: number;
  name: string;
  description?: string;
  color?: string;
  isPublic: boolean;
  ownerId: number;
  parentId?: number;
  createdAt: string;
  updatedAt: string;
  links?: LinkwardenLink[];
  collections?: LinkwardenCollection[];
}

export interface LinkwardenLink {
  id: number;
  name: string;
  type: "url";
  description?: string;
  url: string;
  collectionId?: number;
  collection?: {
    id: number;
    name?: string;
  };
  createdAt: string;
  updatedAt: string;
  tags?: LinkwardenTag[];
}

export interface LinkwardenTag {
  id: number;
  name: string;
}

export interface LinkwardenError {
  message: string;
  status?: number;
}
