import { MongoClient, GridFSBucket, ObjectId } from "mongodb";

let client;
let dbPromise;

function getClient() {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error(
        "Thiếu MONGODB_URI trong .env (dán connection string từ MongoDB Atlas vào)"
      );
    }
    client = new MongoClient(uri);
  }
  return client;
}

/**
 * Lấy kết nối tới database (chỉ connect 1 lần, tái sử dụng cho cả app).
 */
export async function getDb() {
  if (!dbPromise) {
    dbPromise = getClient()
      .connect()
      .then((c) => c.db(process.env.MONGODB_DB_NAME || "runway_queue"));
  }
  return dbPromise;
}

export async function getItemsCollection() {
  const db = await getDb();
  return db.collection("items");
}

/**
 * GridFS bucket dùng để lưu file video (thay cho folder downloads/ trên đĩa Railway,
 * vì đĩa Railway bị xoá mỗi lần redeploy/restart container).
 */
export async function getVideoBucket() {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "videos" });
}

export { ObjectId };
