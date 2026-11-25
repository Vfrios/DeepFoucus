import '../lib/env';
import { Collection, Document, MongoClient, ObjectId } from 'mongodb';
import { CategoryForDedupe, planCategoryDedupe } from '../lib/categoryDedupe';

type CategoryDocument = Document & CategoryForDedupe<ObjectId>;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI não definida');

  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--apply')) {
    throw new Error('Uso: npm run categories:dedupe [-- --apply]');
  }
  const apply = args.includes('--apply');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'wall_dashboard');
    const categories: Collection<CategoryDocument> = db.collection('categories');
    const documents = await categories.find({}).toArray();
    const plan = planCategoryDedupe(documents);
    const duplicateCount = plan.reduce((count, group) => count + group.duplicateIds.length, 0);

    console.log(`Categorias lidas: ${documents.length}`);
    console.log(`Grupos duplicados: ${plan.length}; documentos duplicados: ${duplicateCount}`);
    console.log(`Modo: ${apply ? 'aplicar alterações' : 'prévia (somente leitura)'}`);

    if (!apply) return;

    for (const group of plan) {
      await categories.updateOne(
        { _id: group.survivorId },
        { $set: { sinonimos: group.sinonimos } }
      );
      await categories.deleteMany({ _id: { $in: group.duplicateIds } });
      await categories.updateOne(
        { _id: group.survivorId },
        { $set: { nomeNormalizado: group.nomeNormalizado, atualizadoEm: new Date() } }
      );
    }

    console.log(`Grupos consolidados: ${plan.length}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Falha ao deduplicar categorias: ${message}`);
  process.exitCode = 1;
});
