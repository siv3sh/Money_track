"""Import RAG package — embeddings + Mongo vector store."""

from rag.embeddings import cosine, embed_text
from rag.vector_store import VectorStore, get_vector_store

__all__ = [
    "embed_text",
    "cosine",
    "VectorStore",
    "get_vector_store",
]
